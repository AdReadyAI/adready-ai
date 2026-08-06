/**
 * agent.ts — Orchestration for the Brief Alignment Agent: prompt assembly,
 * the shared chat() call, and guardrails on the returned findings.
 *
 * Model selection is owned by shared/llm.ts via OPENROUTER_MODEL — this agent
 * never hardcodes a model id.
 */

import { chat, type ChatMessage } from "../shared/llm.ts";
import { highestFailedSeverity } from "../shared/checks.ts";
import type {
  AgentContext,
  ConfidenceLevel,
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";
import {
  buildOutputSchema,
  CONFIDENCE_LEVELS,
  CORRECTION_TYPES,
  EVIDENCE_TYPES,
  METRIC_CONFIGS,
  type MetricConfig,
  RESULT_VALUES,
  SEVERITY_LEVELS,
  SUB_CHECK_NAMES,
  SUB_CHECK_RESULT_VALUES,
  type SubCheckId,
} from "./metrics.ts";
import { buildUserContent } from "./evidence.ts";

/** Injectable chat function for unit tests; defaults to shared chat(). */
export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

const SYSTEM_PROMPT =
  `You are the Brief Alignment agent in an ad-review pipeline. You grade a ` +
  `video ad against its creative brief using only the parsed brief, transcript, ` +
  `on-screen text, and visual-frame descriptions you are given. You never see ` +
  `the raw video. For each metric, decide status, grade severity (none, low, ` +
  `medium, high, critical), cite specific evidence (a transcript span, an OCR ` +
  `line, a visual-frame description, or a brief line), and self-report ` +
  `confidence (low, medium, high). If you cannot cite specific evidence for a ` +
  `finding, your confidence for it must be low. Use cannot_assess when the ` +
  `brief gives nothing to check a metric against. Respond with a single JSON ` +
  `object that matches the provided schema — no markdown fences, no prose.`;

type RawFinding = {
  metric_id?: unknown;
  result?: unknown;
  severity?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  explanation?: unknown;
  suggested_correction?: unknown;
  correction_type?: unknown;
  sub_checks?: unknown;
};

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const raw = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("model returned invalid JSON");
  }
}

function sanitizeEvidence(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(EVIDENCE_TYPES);
  const out: EvidenceRef[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.type !== "string" || !allowed.has(rec.type)) continue;
    if (typeof rec.text !== "string") continue;
    out.push({
      type: rec.type as EvidenceRef["type"],
      text: rec.text,
      timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "",
    });
  }
  return out;
}

/** Reverse map of display name -> check_id, for recovering mislabeled checks. */
function buildNameToId(
  names: Record<string, string>,
  ids: readonly string[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of ids) {
    const n = names[id];
    if (n) m.set(n.toLowerCase(), id);
  }
  return m;
}

/**
 * Recover a known check_id from a sub-check the model may have mislabeled.
 * Accepts the canonical `check_id` as well as common variants (`check`, `id`,
 * or the display `name`), matching either a known id or a known display name.
 * Returns null only when nothing maps to a configured check — so a real finding
 * that arrives under `check` instead of `check_id` is kept, not silently dropped.
 */
function resolveCheckId(
  rec: Record<string, unknown>,
  allowed: Set<string>,
  nameToId: Map<string, string>,
): string | null {
  for (const key of ["check_id", "check", "id", "name"]) {
    const v = rec[key];
    if (typeof v !== "string") continue;
    if (allowed.has(v)) return v;
    const byName = nameToId.get(v.toLowerCase());
    if (byName) return byName;
  }
  return null;
}

function sanitizeSubChecks(
  raw: unknown,
  allowedIds: readonly SubCheckId[],
): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(allowedIds);
  const nameToId = buildNameToId(SUB_CHECK_NAMES, allowedIds);
  const validResults = new Set<string>(SUB_CHECK_RESULT_VALUES);
  const validSeverities = new Set<string>(SEVERITY_LEVELS);
  const out: SubCheckResult[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    const checkId = resolveCheckId(rec, allowed, nameToId);
    if (!checkId) continue;
    if (typeof rec.result !== "string" || !validResults.has(rec.result)) {
      continue;
    }
    if (
      typeof rec.severity !== "string" || !validSeverities.has(rec.severity)
    ) continue;
    // Normalize the result/severity pair so it satisfies the shared semantic
    // invariants (validation.ts): passed -> none, failed -> a real severity,
    // cannot_assess -> cannot_assess on both fields.
    let result = rec.result as SubCheckResult["result"];
    let severity = rec.severity as SeverityLevel;
    if (result === "cannot_assess" || severity === "cannot_assess") {
      result = "cannot_assess";
      severity = "cannot_assess";
    } else if (result === "passed") {
      severity = "none";
    } else if (severity === "none") {
      // A failed sub-check must carry a non-none severity.
      severity = "low";
    }
    out.push({
      check_id: checkId,
      name: SUB_CHECK_NAMES[checkId as SubCheckId] ?? checkId,
      result,
      severity,
      explanation: typeof rec.explanation === "string"
        ? rec.explanation
        : undefined,
    });
  }
  return out;
}

/** A metric carries a real correction when a fix type or fix text is present. */
function hasCorrection(
  correctionType: MetricResult["correction_type"],
  suggestedCorrection: string | undefined,
): boolean {
  if (correctionType && correctionType !== "none") return true;
  const s = suggestedCorrection?.trim().toLowerCase();
  return !!s && s !== "none";
}

/**
 * Reconcile an internally contradictory result/severity pair from the model.
 * A metric only "passes" (`true`) when nothing is wrong: severity `none`, no
 * failed sub-check, and no correction. Any real problem forces `false` AND a
 * non-`none` severity — the two must move together, so a failing verdict (or one
 * that asks for a correction) can never report `severity: "none"`. When severity
 * is missing it is derived from the worst failed sub-check (falling back to
 * `low`). `cannot_assess` on either field is always left untouched.
 */
function reconcile(
  result: MetricResult["result"],
  severity: SeverityLevel,
  subChecks: SubCheckResult[],
  correctionType: MetricResult["correction_type"],
  suggestedCorrection: string | undefined,
): { result: MetricResult["result"]; severity: SeverityLevel } {
  if (result === "cannot_assess" || severity === "cannot_assess") {
    return { result: "cannot_assess", severity: "cannot_assess" };
  }
  const failed = subChecks.filter((s) => s.result === "failed");
  const problem = severity !== "none" || failed.length > 0 ||
    hasCorrection(correctionType, suggestedCorrection);
  if (!problem) return { result: "true", severity: "none" };
  let sev: SeverityLevel = severity;
  if (sev === "none") {
    sev = highestFailedSeverity(subChecks);
    if (sev === "none" || sev === "cannot_assess") sev = "low";
  }
  return { result: "false", severity: sev };
}

function buildMetricResult(
  config: MetricConfig,
  raw: RawFinding | undefined,
): MetricResult {
  const result = typeof raw?.result === "string" &&
      (RESULT_VALUES as readonly string[]).includes(raw.result)
    ? (raw.result as MetricResult["result"])
    : "cannot_assess";
  const severity = typeof raw?.severity === "string" &&
      (SEVERITY_LEVELS as readonly string[]).includes(raw.severity)
    ? (raw.severity as SeverityLevel)
    : "cannot_assess";
  let confidence: ConfidenceLevel | undefined =
    typeof raw?.confidence === "string" &&
      (CONFIDENCE_LEVELS as readonly string[]).includes(raw.confidence)
      ? (raw.confidence as ConfidenceLevel)
      : undefined;

  const evidence = sanitizeEvidence(raw?.evidence);
  if (evidence.length === 0) {
    confidence = "low";
  }

  const subChecks = sanitizeSubChecks(raw?.sub_checks, config.sub_check_ids);

  const correctionType = typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
    ? (raw.correction_type as MetricResult["correction_type"])
    : "none";
  const suggestedCorrection = typeof raw?.suggested_correction === "string"
    ? raw.suggested_correction
    : undefined;

  const { result: reconciledResult, severity: reconciledSeverity } = reconcile(
    result,
    severity,
    subChecks,
    correctionType,
    suggestedCorrection,
  );

  // A metric that cannot be assessed cannot carry a correction — you can't fix
  // what there was nothing to evaluate.
  const noAssess = reconciledResult === "cannot_assess";

  return {
    metric_id: config.metric_id,
    agent: "brief_alignment",
    metric_name: config.metric_name,
    question: config.question,
    result: reconciledResult,
    severity: reconciledSeverity,
    confidence,
    evidence,
    explanation: typeof raw?.explanation === "string"
      ? raw.explanation
      : undefined,
    suggested_correction: noAssess ? undefined : suggestedCorrection,
    correction_type: noAssess ? "none" : correctionType,
    sub_checks: subChecks,
  };
}

export async function runBriefAlignmentAgent(
  context: AgentContext,
  chatFn: ChatFn = chat,
): Promise<MetricResult[]> {
  const schema = buildOutputSchema();
  const content = await chatFn([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        buildUserContent(context),
        "",
        "Return ONLY a JSON object matching this schema:",
        JSON.stringify(schema),
      ].join("\n"),
    },
  ]);

  let parsed: { findings?: unknown };
  try {
    parsed = parseJsonContent(content) as { findings?: unknown };
  } catch {
    throw new Error("model returned invalid JSON");
  }

  const findings = Array.isArray(parsed.findings)
    ? (parsed.findings as RawFinding[])
    : [];
  const byMetricId = new Map<string, RawFinding>();
  for (const f of findings) {
    if (typeof f.metric_id === "string") byMetricId.set(f.metric_id, f);
  }

  return METRIC_CONFIGS.map((config) =>
    buildMetricResult(config, byMetricId.get(config.metric_id))
  );
}
