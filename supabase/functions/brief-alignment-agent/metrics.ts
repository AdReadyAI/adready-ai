/**
 * metrics.ts — Static metric/sub-check metadata and OpenAI-style tool schema
 * for the Brief Alignment Agent. Nothing here comes from the model at
 * runtime; this is the fixed shape the agent grades against.
 */

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

export const TOOL_NAME = "submit_brief_alignment_findings";

export function buildToolSchema() {
  return {
    type: "function" as const,
    function: {
      name: TOOL_NAME,
      description:
        "Submit graded findings for every Brief Alignment metric (audience_fit, brief_adherence). Always include both, even if the result is cannot_assess.",
      parameters: {
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
      },
    },
  };
}
