/**
 * metrics.ts — Static metric/sub-check metadata and OpenAI-style tool schema
 * for the Product Representation Agent. Nothing here comes from the model at
 * runtime; this is the fixed shape the agent grades against.
 *
 * insufficient_visibility is intentionally excluded from the tool schema: it's
 * computed deterministically in agent.ts from product-frame timing/coverage,
 * not graded by the model.
 *
 * The enum value lists are sourced from the shared Zod schemas so the tool
 * schema and validation stay in lockstep with the shared MetricResult contract.
 */

import {
  ConfidenceLevelSchema,
  EvidenceRefSchema,
  MetricResultSchema,
  SeverityLevelSchema,
  SubCheckResultSchema,
} from "../shared/schemas.ts";

export type LlmSubCheckId =
  | "product_not_shown"
  | "product_obscured"
  | "product_appearance_wrong"
  | "product_name_unspoken";

export type DeterministicSubCheckId = "insufficient_visibility";

export type SubCheckId = LlmSubCheckId | DeterministicSubCheckId;

export const LLM_SUB_CHECK_IDS: LlmSubCheckId[] = [
  "product_not_shown",
  "product_obscured",
  "product_appearance_wrong",
  "product_name_unspoken",
];

export const SUB_CHECK_NAMES: Record<SubCheckId, string> = {
  product_not_shown: "Product Presence Check",
  product_obscured: "Product Visibility Check",
  product_appearance_wrong: "Product Appearance",
  product_name_unspoken: "Brand Name Mention Check",
  insufficient_visibility: "Product Screen-Time Coverage",
};

export const METRIC_ID = "product_clarity" as const;
export const METRIC_NAME = "Product Clarity";
export const METRIC_QUESTION =
  "Can a viewer clearly identify what product is being advertised?";

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

export const TOOL_NAME = "submit_product_representation_findings";

export function buildToolSchema() {
  return {
    type: "function" as const,
    function: {
      name: TOOL_NAME,
      description:
        "Submit the graded product_clarity finding for this ad, covering " +
        "product_not_shown, product_obscured, product_appearance_wrong, " +
        "and product_name_unspoken. Do not include insufficient_visibility " +
        "— that sub-check is computed separately from product-frame timing.",
      parameters: {
        type: "object",
        required: [
          "result",
          "severity",
          "confidence",
          "evidence",
          "sub_checks",
        ],
        properties: {
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
                check_id: { type: "string", enum: LLM_SUB_CHECK_IDS },
                result: { type: "string", enum: SUB_CHECK_RESULT_VALUES },
                severity: { type: "string", enum: SEVERITY_LEVELS },
                explanation: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}
