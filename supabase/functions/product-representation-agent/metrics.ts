/**
 * metrics.ts — Static metric/sub-check metadata and OpenAI-style tool schema
 * for the Product Representation Agent. Nothing here comes from the model
 * at runtime; this is the fixed shape the agent grades against.
 *
 * insufficient_visibility is intentionally excluded from the tool schema:
 * it's computed deterministically in agent.ts from product_moments timing,
 * not graded by the model.
 */

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

export const SEVERITY_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
  "cannot_assess",
] as const;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const RESULT_VALUES = ["true", "false", "cannot_assess"] as const;

export const SUB_CHECK_RESULT_VALUES = [
  "passed",
  "failed",
  "cannot_assess",
] as const;

export const CORRECTION_TYPES = [
  "rewrite",
  "edit_recommendation",
  "technical_fix",
  "none",
] as const;

export const EVIDENCE_TYPES = [
  "transcript",
  "ocr",
  "visual",
  "brief",
  "product_page",
  "metadata",
] as const;

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
        "— that sub-check is computed separately from timing data.",
      parameters: {
        type: "object",
        required: ["result", "severity", "confidence", "evidence", "sub_checks"],
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
