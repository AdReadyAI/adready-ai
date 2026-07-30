/**
 * agent.ts — Orchestration for the Product Representation Agent: the
 * deterministic product-frame coverage check, the shared chat() call for the
 * remaining sub-checks, and guardrails on the merged result.
 *
 * Model selection is owned by shared/llm.ts via OPENROUTER_MODEL — this agent
 * never hardcodes a model id.
 */

import { chat, type ChatMessage } from "../shared/llm.ts";
import {
  cannotAssess,
  failed as failedCheck,
  highestFailedSeverity,
  passed,
  severityRank,
} from "../shared/checks.ts";
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
  LLM_SUB_CHECK_IDS,
  METRIC_ID,
  METRIC_NAME,
  METRIC_QUESTION,
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
  `You are the Product Representation agent in an ad-review pipeline. You grade ` +
  `whether the advertised product is clearly represented, using only the ` +
  `product-frame descriptions, logo-frame descriptions, transcript, on-screen ` +
  `text, and product context you are given — you never see the raw video or the ` +
  `frame images. product_appearance_wrong can only be judged from on-screen ` +
  `text (OCR) or product context compared against the brief's product/packaging ` +
  `description; return cannot_assess for it if there is no relevant OCR text or ` +
  `product context, do not guess from frame descriptions alone. Grade severity ` +
  `(none, low, medium, high, critical), cite specific evidence, and self-report ` +
  `confidence (low, medium, high) — if you cannot cite specific evidence, ` +
  `confidence must be low. Do not include an insufficient_visibility sub-check ` +
  `— that one is computed separately. Respond with a single JSON object that ` +
  `matches the provided schema — no markdown fences, no prose.`;

export const APPEARANCE_DEADLINE_MS = 3000;
export const MIN_COVERAGE_RATIO = 0.15;

function worseSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return severityRank(b) > severityRank(a) ? b : a;
}

/**
 * Deterministic screen-time coverage check, computed from product frames rather
 * than the model. Coverage is approximated as the fraction of sampled visual
 * frames in which the product is present, since the frame-based context no longer
 * carries product time intervals. "Late" is the first frame in which the product
 * is present relative to APPEARANCE_DEADLINE_MS.
 */
export function computeInsufficientVisibilitySubCheck(
  context: AgentContext,
): SubCheckResult {
  const name = SUB_CHECK_NAMES.insufficient_visibility;
  const present = context.product_frames.filter(
    (f) => f.prominence !== "not_visible",
  );

  if (!context.product_frames.length || !present.length) {
    return cannotAssess(
      "insufficient_visibility",
      name,
      "No product frames indicate the product is visible, so screen-time coverage cannot be computed.",
    );
  }

  const firstAppearanceMs = Math.min(...present.map((f) => f.timestamp_ms));
  const visualCount = context.visual_frames.length;
  const coverageRatio = visualCount > 0 ? present.length / visualCount : null;

  const late = firstAppearanceMs > APPEARANCE_DEADLINE_MS;
  const thin = coverageRatio !== null && coverageRatio < MIN_COVERAGE_RATIO;

  if (!late && !thin) {
    return passed("insufficient_visibility", name);
  }

  const severity: "high" | "medium" = late && thin ? "high" : "medium";
  const reasons = [
    late
      ? `first appears at ${firstAppearanceMs}ms (after the ${APPEARANCE_DEADLINE_MS}ms deadline)`
      : "",
    thin && coverageRatio !== null
      ? `appears in only ${
        (coverageRatio * 100).toFixed(1)
      }% of sampled frames (below ${(MIN_COVERAGE_RATIO * 100).toFixed(0)}%)`
      : "",
  ].filter(Boolean).join(" and ");

  return failedCheck(
    "insufficient_visibility",
    name,
    severity,
    `Product ${reasons}.`,
  );
}

type RawFinding = {
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
 * Returns null only when nothing maps to a configured check.
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

function sanitizeSubChecks(raw: unknown): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(LLM_SUB_CHECK_IDS);
  const nameToId = buildNameToId(SUB_CHECK_NAMES, LLM_SUB_CHECK_IDS);
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
 * non-`none` severity — the two must move together, so a failing verdict can
 * never report `severity: "none"`. When severity is missing, it is derived from
 * the worst failed sub-check (falling back to `low`). `cannot_assess` on either
 * field is always left untouched.
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

function buildLlmMetricResult(raw: RawFinding | undefined): MetricResult {
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

  const correctionType = typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
    ? (raw.correction_type as MetricResult["correction_type"])
    : "none";
  const suggestedCorrection = typeof raw?.suggested_correction === "string"
    ? raw.suggested_correction
    : undefined;

  const subChecks = sanitizeSubChecks(raw?.sub_checks);
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
    metric_id: METRIC_ID,
    agent: "product_representation",
    metric_name: METRIC_NAME,
    question: METRIC_QUESTION,
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

export async function runProductRepresentationAgent(
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

  let raw: RawFinding;
  try {
    raw = parseJsonContent(content) as RawFinding;
  } catch {
    throw new Error("model returned invalid JSON");
  }

  const llmResult = buildLlmMetricResult(raw);
  const visibilityCheck = computeInsufficientVisibilitySubCheck(context);

  const visibilityFailed = visibilityCheck.result === "failed";
  const finalResult: MetricResult["result"] = visibilityFailed
    ? "false"
    : llmResult.result;
  // Keep the merged pair semantically valid (validation.ts): a cannot_assess
  // verdict must carry cannot_assess severity, even if the deterministic check
  // passed with severity none.
  const finalSeverity: SeverityLevel = finalResult === "cannot_assess"
    ? "cannot_assess"
    : worseSeverity(llmResult.severity, visibilityCheck.severity);

  // The deterministic coverage failure is authoritative — surface it in the
  // explanation and a correction so the verdict is not "false" alongside a
  // "no issues / no correction needed" narrative from the model.
  let explanation = llmResult.explanation;
  let suggestedCorrection = llmResult.suggested_correction;
  let correctionType = llmResult.correction_type;
  if (visibilityFailed) {
    const note = visibilityCheck.explanation ??
      "The product does not meet the required on-screen coverage.";
    explanation = explanation && explanation.trim()
      ? `${note} ${explanation.trim()}`
      : note;
    if (!correctionType || correctionType === "none") {
      correctionType = "edit_recommendation";
    }
    const sc = suggestedCorrection?.trim();
    if (!sc || sc.toLowerCase() === "none") {
      suggestedCorrection = `Show the product clearly within the first ${
        APPEARANCE_DEADLINE_MS / 1000
      }s and keep it on screen long enough to meet minimum coverage.`;
    }
  }

  return [
    {
      ...llmResult,
      result: finalResult,
      severity: finalSeverity,
      explanation,
      suggested_correction: suggestedCorrection,
      correction_type: correctionType,
      sub_checks: [...(llmResult.sub_checks ?? []), visibilityCheck],
    },
  ];
}
