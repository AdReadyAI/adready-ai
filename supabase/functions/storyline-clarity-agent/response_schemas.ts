/**
 * response_schemas.ts — Zod schemas + parsing for the Storyline agent's two LLM replies.
 *
 * Call 1 returns the narrative arc (derivation only). Call 2 returns the shared
 * evaluation envelope: the LLM sub-check verdicts plus the metric-level fields.
 * Both are validated here; a reply that does not match parses to null (via
 * `safeParseJson`) and the agent degrades to cannot_assess.
 *
 * This file also owns the tolerant JSON extraction and the converters that turn
 * one LLM verdict into a SubCheckResult — kept inside the agent folder so it is
 * self-contained rather than depending on a shared framework.
 */

import { z } from "zod";
import {
  ConfidenceLevelSchema,
  type EvidenceRef,
  type MetricResult,
  type SeverityLevel,
  SeverityLevelSchema,
  type SubCheckResult,
} from "../shared/schemas.ts";
import { cannotAssess, clampSeverity, failed, passed } from "./checks.ts";

// ── Call 1 — narrative structure (derivation), labeled over visual_frames ─────

export const ARC_ROLES = [
  "hook",
  "problem",
  "solution",
  "proof",
  "payoff",
  "cta",
  "detour",
] as const;
export const ArcRoleSchema = z.enum(ARC_ROLES);
export type ArcRole = z.infer<typeof ArcRoleSchema>;

export const ArcLabelingSchema = z.object({
  arc: z.array(
    z.object({
      frame_id: z.string(),
      role: ArcRoleSchema,
      confidence: ConfidenceLevelSchema,
    }),
  ),
  unfilled_roles: z.array(z.string()),
  payoff_resolved_at: z.string().nullable(),
  overall_confidence: ConfidenceLevelSchema,
});
export type ArcLabeling = z.infer<typeof ArcLabelingSchema>;

// ── Call 2 — the shared evaluation envelope ──────────────────────────────────

/** One sub-check verdict as returned inside a Call-2 reply. */
export const LlmSubCheckSchema = z.object({
  check_id: z.string(),
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: SeverityLevelSchema,
  explanation: z.string().nullish(), // model may send null on passing checks
});
export type LlmSubCheck = z.infer<typeof LlmSubCheckSchema>;

/**
 * Lenient evidence as the model may emit it — `type` is a free string and
 * `timestamp` may be absent. `coerceEvidence` normalizes it to a valid
 * EvidenceRef before it reaches the metric_result.
 */
const LlmEvidenceSchema = z.object({
  type: z.string(),
  text: z.string(),
  timestamp: z.string().nullish(), // model may send null or omit it
});

/**
 * An optional field that also tolerates an explicit `null`. Models routinely emit
 * `"suggested_correction": null` (or `explanation`/`correction_type`/`confidence`)
 * when a field is N/A; a bare `.optional()` accepts omitted-but-not-null and would
 * reject the whole reply. This accepts value | null | omitted and normalizes null
 * to `undefined` so downstream `?.`/`??` usage is unaffected.
 */
function nullishToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((v) => v ?? undefined);
}

/**
 * The standard Call-2 envelope: the sub-check verdicts (load-bearing) plus
 * metric-level fields. Everything except `sub_checks` is optional so a reply that
 * nests or omits the metric-level fields still parses on the strength of its
 * sub-checks rather than being discarded whole.
 */
export const EvaluationResponseSchema = z.object({
  sub_checks: z.array(LlmSubCheckSchema),
  confidence: nullishToUndefined(ConfidenceLevelSchema),
  evidence: nullishToUndefined(z.array(LlmEvidenceSchema)),
  explanation: nullishToUndefined(z.string()),
  suggested_correction: nullishToUndefined(z.string()),
  correction_type: nullishToUndefined(z.string()),
});
export type EvaluationResponse = z.infer<typeof EvaluationResponseSchema>;

// Aliases: the Storyline agent's Call 2 uses the shared evaluation envelope.
export { EvaluationResponseSchema as StorylineEvaluationSchema };
export type StorylineEvaluation = EvaluationResponse;

// ── Tolerant JSON extraction + validation (never throws) ──────────────────────

/**
 * Pull the most likely JSON payload out of raw model text: strip a code fence if
 * present, else slice from the first opening bracket to the last matching close.
 */
export function extractJsonText(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();

  // Fast path: the body is already valid JSON.
  try {
    JSON.parse(body);
    return body;
  } catch {
    // Fall through to bracket slicing.
  }

  const objStart = body.indexOf("{");
  const arrStart = body.indexOf("[");
  let start = -1;
  let close = "";
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    start = arrStart;
    close = "]";
  } else if (objStart !== -1) {
    start = objStart;
    close = "}";
  }
  if (start === -1) return null;

  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  return body.slice(start, end + 1);
}

/**
 * Parse + validate raw model text against `schema`. Returns null on any failure.
 * Generic over the schema so the return type is the schema's *output*
 * (`z.infer<S>`), which matters for schemas that use `.transform`.
 */
export function safeParseJson<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): z.infer<S> | null {
  const text = extractJsonText(raw);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

// ── Verdict → SubCheckResult converters ───────────────────────────────────────

const EVIDENCE_TYPES = [
  "transcript",
  "ocr",
  "visual",
  "brief",
  "product_page",
  "metadata",
] as const;

/** Normalize model-supplied evidence into valid EvidenceRefs (unknown type → metadata). */
export function coerceEvidence(
  evidence: EvaluationResponse["evidence"],
): EvidenceRef[] | undefined {
  if (evidence === undefined) return undefined;
  return evidence.map((e) => ({
    type: (EVIDENCE_TYPES as readonly string[]).includes(e.type)
      ? (e.type as EvidenceRef["type"])
      : "metadata",
    text: e.text,
    timestamp: e.timestamp ?? "",
  }));
}

const VALID_CORRECTION_TYPES = [
  "rewrite",
  "edit_recommendation",
  "technical_fix",
  "none",
] as const;

/**
 * Coerce a model-supplied correction_type to the schemas.ts enum so output
 * always validates. Off-enum or missing values fall back to edit_recommendation.
 */
export function coerceCorrectionType(
  value: string | undefined,
): MetricResult["correction_type"] {
  return (VALID_CORRECTION_TYPES as readonly string[]).includes(value ?? "")
    ? (value as MetricResult["correction_type"])
    : "edit_recommendation";
}

/**
 * Convert one Call-2 verdict into a SubCheckResult. A missing verdict degrades
 * to cannot_assess; a failed verdict's severity is clamped to `max` (validating
 * the model against the range the sub-check is allowed to carry).
 */
export function fromLlmSubCheck(
  check: LlmSubCheck | undefined,
  id: string,
  name: string,
  max: SeverityLevel,
  missingReason: string,
): SubCheckResult {
  if (check === undefined) return cannotAssess(id, name, missingReason);
  if (check.result === "passed") return passed(id, name);
  if (check.result === "cannot_assess") {
    return cannotAssess(
      id,
      name,
      check.explanation ?? "Model could not assess this check.",
    );
  }
  // A failed verdict must carry a real risk severity: clamp to the sub-check's
  // ceiling, then floor a none/unranked severity up to "low".
  const clamped = clampSeverity(check.severity, max);
  const severity = clamped === "none" || clamped === "cannot_assess"
    ? "low"
    : clamped;
  return failed(id, name, severity, check.explanation ?? "Sub-check failed.");
}

/** Index a Call-2 reply's sub-checks by check_id (last write wins on dupes). */
export function indexSubChecks(
  evaluation: EvaluationResponse | null,
): Map<string, LlmSubCheck> {
  const byId = new Map<string, LlmSubCheck>();
  for (const sc of evaluation?.sub_checks ?? []) byId.set(sc.check_id, sc);
  return byId;
}
