/**
 * metrics.ts — Static metric/sub-check metadata and the JSON output schema
 * the Brief Alignment Agent asks the model to return.
 *
 * The enum value lists are sourced from the shared Zod schemas so the prompt
 * schema and validation stay in lockstep with the shared MetricResult contract.
 */

import {
  ConfidenceLevelSchema,
  EvidenceRefSchema,
  MetricResultSchema,
  SeverityLevelSchema,
  SubCheckResultSchema,
} from "../shared/schemas.ts";

export type BriefAlignmentMetricId = "audience_fit" | "brief_adherence";

export type SubCheckId =
  | "demographic_mismatch"
  | "demographic_restricted"
  | "objective_missed"
  | "required_message_missing";

export type MetricConfig = {
  metric_id: BriefAlignmentMetricId;
  metric_name: string;
  question: string;
  sub_check_ids: SubCheckId[];
};

export const METRIC_CONFIGS: MetricConfig[] = [
  {
    metric_id: "audience_fit",
    metric_name: "Audience Fit",
    question:
      "Does the video speak to the intended audience's needs, motivations, or context?",
    sub_check_ids: ["demographic_mismatch", "demographic_restricted"],
  },
  {
    metric_id: "brief_adherence",
    metric_name: "Brief Adherence",
    question:
      "Does the video satisfy the core campaign objective and required message from the creative brief?",
    sub_check_ids: ["objective_missed", "required_message_missing"],
  },
];

export const METRIC_IDS: BriefAlignmentMetricId[] = METRIC_CONFIGS.map(
  (m) => m.metric_id,
);

export const ALL_SUB_CHECK_IDS: SubCheckId[] = METRIC_CONFIGS.flatMap(
  (m) => m.sub_check_ids,
);

export const SUB_CHECK_NAMES: Record<SubCheckId, string> = {
  demographic_mismatch: "Demographic Profile Match",
  demographic_restricted: "Age Restriction Check",
  objective_missed: "Campaign Objective Alignment",
  required_message_missing: "Creative Brief Message Adherence",
};

// Enum value lists sourced from the shared schemas (single source of truth).
export const SEVERITY_LEVELS = SeverityLevelSchema.options;
export const CONFIDENCE_LEVELS = ConfidenceLevelSchema.options;
export const RESULT_VALUES = MetricResultSchema.shape.result.options;
export const SUB_CHECK_RESULT_VALUES =
  SubCheckResultSchema.shape.result.options;
export const CORRECTION_TYPES =
  MetricResultSchema.shape.correction_type.unwrap()
    .options;
export const EVIDENCE_TYPES = EvidenceRefSchema.shape.type.options;

/**
 * JSON Schema describing the object the model must return as its entire reply.
 * Embedded in the prompt; the shared chat() helper has no tool-call support.
 */
export function buildOutputSchema() {
  return {
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        minItems: METRIC_CONFIGS.length,
        maxItems: METRIC_CONFIGS.length,
        items: {
          type: "object",
          required: [
            "metric_id",
            "result",
            "severity",
            "confidence",
            "evidence",
            "sub_checks",
          ],
          properties: {
            metric_id: { type: "string", enum: METRIC_IDS },
            result: { type: "string", enum: RESULT_VALUES },
            severity: { type: "string", enum: SEVERITY_LEVELS },
            confidence: { type: "string", enum: CONFIDENCE_LEVELS },
            evidence: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "text", "timestamp"],
                properties: {
                  type: { type: "string", enum: EVIDENCE_TYPES },
                  text: { type: "string" },
                  timestamp: { type: "string" },
                },
              },
            },
            explanation: { type: "string" },
            suggested_correction: { type: "string" },
            correction_type: { type: "string", enum: CORRECTION_TYPES },
            sub_checks: {
              type: "array",
              items: {
                type: "object",
                required: ["check_id", "result", "severity"],
                properties: {
                  check_id: { type: "string", enum: ALL_SUB_CHECK_IDS },
                  result: {
                    type: "string",
                    enum: SUB_CHECK_RESULT_VALUES,
                  },
                  severity: { type: "string", enum: SEVERITY_LEVELS },
                  explanation: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}
