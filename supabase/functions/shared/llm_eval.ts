/**
 * llm_eval.ts — Shared Call-2 evaluation plumbing for evaluator agents.
 *
 * Every agent's Call 2 returns the same envelope: a list of per-sub-check
 * verdicts plus metric-level fields. This module owns that schema, the converter
 * that turns one LLM verdict into a SubCheckResult (clamping severity to the
 * sub-check's allowed ceiling), and correction_type coercion — so both agents
 * share one implementation instead of re-deriving it.
 */

import { z } from "zod";
import {
  ConfidenceLevelSchema,
  EvidenceRefSchema,
  type MetricResult,
  type SeverityLevel,
  SeverityLevelSchema,
  type SubCheckResult,
} from "./schemas.ts";
import { cannotAssess, failed, passed } from "./subcheck.ts";
import { clampSeverity, severityRank } from "./severity.ts";

/** One sub-check verdict as returned inside a Call-2 reply. */
export const LlmSubCheckSchema = z.object({
  check_id: z.string(),
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: SeverityLevelSchema,
  explanation: z.string().optional(),
});
export type LlmSubCheck = z.infer<typeof LlmSubCheckSchema>;

/** The standard Call-2 envelope: sub-check verdicts + metric-level fields. */
export const EvaluationResponseSchema = z.object({
  sub_checks: z.array(LlmSubCheckSchema),
  confidence: ConfidenceLevelSchema,
  evidence: z.array(EvidenceRefSchema).optional(),
  explanation: z.string().optional(),
  suggested_correction: z.string().optional(),
  correction_type: z.string().optional(),
});
export type EvaluationResponse = z.infer<typeof EvaluationResponseSchema>;

const VALID_CORRECTION_TYPES = [
  "rewrite",
  "edit_recommendation",
  "technical_fix",
  "none",
] as const;

/**
 * Coerce a model-supplied correction_type to the schemas.ts enum so output
 * always validates. Off-enum or missing values fall back to edit_recommendation
 * (the only value seen in the spec so far).
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
  const raw = severityRank(check.severity) < 0 ? "low" : check.severity;
  return failed(
    id,
    name,
    clampSeverity(raw, max),
    check.explanation ?? "Sub-check failed.",
  );
}

/** Index a Call-2 reply's sub-checks by check_id (last write wins on dupes). */
export function indexSubChecks(
  evaluation: EvaluationResponse | null,
): Map<string, LlmSubCheck> {
  const byId = new Map<string, LlmSubCheck>();
  for (const sc of evaluation?.sub_checks ?? []) byId.set(sc.check_id, sc);
  return byId;
}
