/**
 * agent.ts — Orchestration for the Brief Alignment Agent: prompt assembly,
 * the shared chat() call, and guardrails on the returned findings.
 *
 * Model selection is owned by shared/llm.ts via OPENROUTER_MODEL — this agent
 * never hardcodes a model id.
 */

import { chat, type ChatMessage } from "../shared/llm.ts";
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

function sanitizeSubChecks(
  raw: unknown,
  allowedIds: readonly SubCheckId[],
): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(allowedIds);
  const validResults = new Set<string>(SUB_CHECK_RESULT_VALUES);
  const validSeverities = new Set<string>(SEVERITY_LEVELS);
  const out: SubCheckResult[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    if (typeof rec.check_id !== "string" || !allowed.has(rec.check_id)) {
      continue;
    }
    if (typeof rec.result !== "string" || !validResults.has(rec.result)) {
      continue;
    }
    if (
      typeof rec.severity !== "string" || !validSeverities.has(rec.severity)
    ) continue;
    out.push({
      check_id: rec.check_id,
      name: SUB_CHECK_NAMES[rec.check_id as SubCheckId] ?? rec.check_id,
      result: rec.result as SubCheckResult["result"],
      severity: rec.severity as SeverityLevel,
      explanation: typeof rec.explanation === "string"
        ? rec.explanation
        : undefined,
    });
  }
  return out;
}

/**
 * Reconcile an internally contradictory result/severity pair from the model.
 * A metric only "passes" (`true`) when nothing is wrong: severity `none` and no
 * failed sub-check. Any real problem (a failed sub-check or severity above
 * `none`) forces `false`. This repairs cases like `result: "false"` reported
 * with `severity: "none"` and all sub-checks passing. `cannot_assess` on either
 * field is always left untouched.
 */
function reconcileResult(
  result: MetricResult["result"],
  severity: SeverityLevel,
  subChecks: SubCheckResult[],
): MetricResult["result"] {
  if (result === "cannot_assess" || severity === "cannot_assess") return result;
  const problem = severity !== "none" ||
    subChecks.some((s) => s.result === "failed");
  return problem ? "false" : "true";
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
  const reconciledResult = reconcileResult(result, severity, subChecks);

  const correctionType = typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
    ? (raw.correction_type as MetricResult["correction_type"])
    : "none";

  return {
    metric_id: config.metric_id,
    agent: "brief_alignment",
    metric_name: config.metric_name,
    question: config.question,
    result: reconciledResult,
    severity,
    confidence,
    evidence,
    explanation: typeof raw?.explanation === "string"
      ? raw.explanation
      : undefined,
    suggested_correction: typeof raw?.suggested_correction === "string"
      ? raw.suggested_correction
      : undefined,
    correction_type: correctionType,
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
