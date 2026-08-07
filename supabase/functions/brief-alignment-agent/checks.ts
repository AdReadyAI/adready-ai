/** Agent-local sub-check normalization and metric roll-up. */

import { cannotAssess, rollupChecks } from "../shared/checks.ts";
import {
  normalizeModelSubCheck,
  resolveEvidenceRefs,
  toCorrectionType,
} from "../shared/modelResponse.ts";
import type {
  AgentContext,
  ConfidenceLevel,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";

import type {
  BriefAlignmentResponse,
  BriefMetricId,
  BriefMetricResponse,
  BriefSubCheckId,
  BriefSubCheckResponse,
} from "./response_schemas.ts";

type MetricDefinition = {
  metricId: BriefMetricId;
  metricName: string;
  question: string;
  checks: Array<{ id: BriefSubCheckId; name: string }>;
};

const METRICS: MetricDefinition[] = [
  {
    metricId: "brief_adherence",
    metricName: "Brief Adherence",
    question:
      "Does the Ad Creative satisfy the campaign objective and required messages in its Creative Brief?",
    checks: [
      { id: "objective_missed", name: "Campaign Objective Alignment" },
      {
        id: "required_message_missing",
        name: "Required Message Adherence",
      },
    ],
  },
  {
    metricId: "audience_fit",
    metricName: "Audience Fit",
    question:
      "Does the Ad Creative speak to the intended audience's needs, motivations, and context?",
    checks: [
      { id: "demographic_mismatch", name: "Audience Profile Match" },
      { id: "demographic_restricted", name: "Audience Restriction Check" },
    ],
  },
];

function missingInputReason(
  context: AgentContext,
  checkId: BriefSubCheckId,
): string | null {
  const hasRawBrief = context.parsed_creative_brief.raw_text.trim().length > 0;

  if (
    checkId === "required_message_missing" &&
    context.parsed_creative_brief.required_messages.length === 0
  ) {
    return "The Creative Brief contains no required messages to assess.";
  }

  if (
    checkId === "objective_missed" &&
    context.campaign_goal.trim().toLowerCase() === "unknown" &&
    !hasRawBrief
  ) {
    return "The Review Request contains no usable Campaign Goal.";
  }

  if (
    (checkId === "demographic_mismatch" ||
      checkId === "demographic_restricted") &&
    !context.parsed_creative_brief.target_audience?.trim() &&
    !hasRawBrief
  ) {
    return "The Creative Brief contains no target audience to assess.";
  }

  return null;
}

/**
 * Apply deterministic Review Input guards after the model responds.
 *
 * These guards prevent model guesses from converting an absent Campaign
 * Context field into either a pass or a failure.
 */
function buildSubChecks(
  context: AgentContext,
  definition: MetricDefinition,
  response: BriefMetricResponse | undefined,
): SubCheckResult[] {
  const byId = new Map<BriefSubCheckId, BriefSubCheckResponse>();
  for (const check of response?.sub_checks ?? []) {
    if (!byId.has(check.check_id)) byId.set(check.check_id, check);
  }

  return definition.checks.map(({ id, name }) => {
    const inputReason = missingInputReason(context, id);
    if (inputReason !== null) return cannotAssess(id, name, inputReason);

    return normalizeModelSubCheck(
      byId.get(id),
      id,
      name,
      `The model response omitted the required ${id} judgment.`,
      "The supplied Review Inputs were insufficient.",
      "The supplied evidence indicates this check failed.",
    );
  });
}

function metricConfidence(
  response: BriefMetricResponse | undefined,
  hasEvidence: boolean,
): ConfidenceLevel {
  if (!hasEvidence) return "low";
  return response?.confidence ?? "low";
}

/** Assemble the two normalized Brief Alignment metrics in canonical order. */
export function buildBriefAlignmentResults(
  context: AgentContext,
  response: BriefAlignmentResponse | null,
): MetricResult[] {
  const byMetric = new Map<BriefMetricId, BriefMetricResponse>();
  for (const metric of response?.metrics ?? []) {
    if (!byMetric.has(metric.metric_id)) {
      byMetric.set(metric.metric_id, metric);
    }
  }

  return METRICS.map((definition) => {
    const modelMetric = byMetric.get(definition.metricId);
    const subChecks = buildSubChecks(context, definition, modelMetric);
    const rollup = rollupChecks(subChecks);
    const evidence = resolveEvidenceRefs(context, modelMetric?.evidence ?? []);
    const isFailure = rollup.result === "false";

    return {
      metric_id: definition.metricId,
      agent: "brief_alignment",
      metric_name: definition.metricName,
      question: definition.question,
      result: rollup.result,
      severity: rollup.severity,
      confidence: metricConfidence(modelMetric, evidence.length > 0),
      evidence,
      explanation: modelMetric?.explanation ?? undefined,
      suggested_correction: isFailure
        ? modelMetric?.suggested_correction ?? undefined
        : undefined,
      correction_type: isFailure
        ? toCorrectionType(modelMetric?.correction_type)
        : "none",
      sub_checks: subChecks,
    };
  });
}
