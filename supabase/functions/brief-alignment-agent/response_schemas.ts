/**
 * Runtime schemas for the Brief Alignment model response.
 *
 * These schemas intentionally describe only this agent's model-facing
 * interface. Shared evaluator schemas remain the final persistence contract.
 */

import { z } from "zod";

import {
  ConfidenceLevelSchema,
  SeverityLevelSchema,
} from "../shared/schemas.ts";
import {
  ModelEvidenceSchema,
  parseModelResponse,
} from "../shared/modelResponse.ts";

export const BriefMetricIdSchema = z.enum([
  "brief_adherence",
  "audience_fit",
]);
export type BriefMetricId = z.infer<typeof BriefMetricIdSchema>;

export const BriefSubCheckIdSchema = z.enum([
  "objective_missed",
  "required_message_missing",
  "demographic_mismatch",
  "demographic_restricted",
]);
export type BriefSubCheckId = z.infer<typeof BriefSubCheckIdSchema>;

export const BriefSubCheckResponseSchema = z.object({
  check_id: BriefSubCheckIdSchema,
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: SeverityLevelSchema,
  explanation: z.string().nullish(),
});
export type BriefSubCheckResponse = z.infer<
  typeof BriefSubCheckResponseSchema
>;

export const BriefMetricResponseSchema = z.object({
  metric_id: BriefMetricIdSchema,
  confidence: ConfidenceLevelSchema.nullish(),
  evidence: z.array(ModelEvidenceSchema).default([]),
  explanation: z.string().nullish(),
  suggested_correction: z.string().nullish(),
  correction_type: z.string().nullish(),
  sub_checks: z.array(BriefSubCheckResponseSchema).default([]),
});
export type BriefMetricResponse = z.infer<typeof BriefMetricResponseSchema>;

export const BriefAlignmentResponseSchema = z.object({
  metrics: z.array(BriefMetricResponseSchema),
});
export type BriefAlignmentResponse = z.infer<
  typeof BriefAlignmentResponseSchema
>;

/** Parse model output without allowing malformed data to cross the agent seam. */
export function parseBriefAlignmentResponse(
  raw: string,
): BriefAlignmentResponse | null {
  return parseModelResponse(raw, BriefAlignmentResponseSchema);
}
