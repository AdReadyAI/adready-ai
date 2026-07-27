/**
 * agent.ts — Orchestration for the Product Representation Agent: the
 * deterministic product-frame coverage check, the shared chat() call for the
 * remaining sub-checks, and guardrails on the merged result.
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

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
  cannot_assess: -1,
};

function worseSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
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
    return {
      check_id: "insufficient_visibility",
      name,
      result: "cannot_assess",
      severity: "cannot_assess",
      explanation:
        "No product frames indicate the product is visible, so screen-time coverage cannot be computed.",
    };
  }

  const firstAppearanceMs = Math.min(...present.map((f) => f.timestamp_ms));
  const visualCount = context.visual_frames.length;
  const coverageRatio = visualCount > 0 ? present.length / visualCount : null;

  const late = firstAppearanceMs > APPEARANCE_DEADLINE_MS;
  const thin = coverageRatio !== null && coverageRatio < MIN_COVERAGE_RATIO;

  if (!late && !thin) {
    return {
      check_id: "insufficient_visibility",
      name,
      result: "passed",
      severity: "none",
    };
  }

  const severity: SeverityLevel = late && thin ? "high" : "medium";
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

  return {
    check_id: "insufficient_visibility",
    name,
    result: "failed",
    severity,
    explanation: `Product ${reasons}.`,
  };
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

function sanitizeSubChecks(raw: unknown): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(LLM_SUB_CHECK_IDS);
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

  const subChecks = sanitizeSubChecks(raw?.sub_checks);
  const reconciledResult = reconcileResult(result, severity, subChecks);

  return {
    metric_id: METRIC_ID,
    agent: "product_representation",
    metric_name: METRIC_NAME,
    question: METRIC_QUESTION,
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

  const finalSeverity = worseSeverity(
    llmResult.severity,
    visibilityCheck.severity,
  );
  const finalResult: MetricResult["result"] =
    visibilityCheck.result === "failed" ? "false" : llmResult.result;

  return [
    {
      ...llmResult,
      result: finalResult,
      severity: finalSeverity,
      sub_checks: [...(llmResult.sub_checks ?? []), visibilityCheck],
    },
  ];
}
