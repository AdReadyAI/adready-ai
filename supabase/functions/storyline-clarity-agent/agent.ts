/**
 * agent.ts — Pipeline orchestration for Storyline Clarity Agent (Single-Call Unified Evaluation)
 */

import { chat } from "../shared/llm.ts";

import { rollupChecks } from "../shared/checks.ts";

import { validateMetricResults } from "../shared/validation.ts";

import type {
  AgentContext,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";

import {
  cannotAssess,
  clampSeverity,
  failed,
  formatNoncompliant,
  isSparseAnalysis,
  narrativeFromFailedChecks,
  reconcileMetricCorrection,
  reconcileStoryIncomplete,
} from "./checks.ts";

import {
  type ArcExpectation,
  getArcExpectation,
  getPlatformSpec,
  type PlatformSpec,
} from "./config.ts";

import {
  type ArcLabeling,
  coerceCorrectionType,
  coerceEvidence,
  fromLlmSubCheck,
  indexSubChecks,
  safeParseJson,
  type StorylineUnifiedResponse,
  StorylineUnifiedResponseSchema,
} from "./response_schemas.ts";

import { unifiedStorylinePrompt } from "./prompts.ts";

const CHANNEL_METRIC = {
  metric_id: "channel_readiness" as const,
  metric_name: "Channel / Placement Readiness",
  question:
    "Is the video fully appropriate for the intended platform, placement, duration, viewing context, and target audience needs/motivations?",
};

const CREATIVE_METRIC = {
  metric_id: "creative_effectiveness" as const,
  metric_name: "Creative Effectiveness Basics",
  question:
    "Does the ad have a clear hook, coherent message flow, and enough stopping power?",
};

const AGENT_NAME = "storyline_clarity" as const;

const LLM_CHECKS = {
  hook_missing: { name: "Hook Presence Check", max: "critical" as const },
  narrative_gap: { name: "Narrative Gap Check", max: "high" as const },
  value_prop_unclear: { name: "Value Prop Check", max: "medium" as const },
  story_incomplete: { name: "Story Completion", max: "medium" as const },
  pacing_misallocation: { name: "Pacing Allocation", max: "medium" as const },
};

const PLACEMENT_MISMATCH = {
  id: "placement_mismatch" as const,
  name: "Placement & Audience Fit",
  max: "high" as const,
};

export type StorylineConfig = {
  platformSpec: PlatformSpec | null;
  arcExpectation: ArcExpectation | null;
};

export function resolveStorylineConfig(ctx: AgentContext): StorylineConfig {
  return {
    platformSpec: getPlatformSpec(ctx.destination_platform),
    arcExpectation: getArcExpectation(ctx.video_metadata.duration_ms),
  };
}

export type MetricLevelFields = {
  confidence?: MetricResult["confidence"];
  evidence?: MetricResult["evidence"];
  explanation?: string;
  suggested_correction?: string;
  correction_type?: MetricResult["correction_type"];
};

function assembleMetric(spec: {
  metric_id: MetricResult["metric_id"];
  metric_name: string;
  question: string;
  sub_checks: SubCheckResult[];
  fields?: MetricLevelFields;
}): MetricResult {
  const { result, severity } = rollupChecks(spec.sub_checks);
  const correction = reconcileMetricCorrection(result, spec.fields ?? {});

  return {
    metric_id: spec.metric_id,
    agent: AGENT_NAME,
    metric_name: spec.metric_name,
    question: spec.question,
    result,
    severity,
    ...spec.fields,
    ...correction,
    sub_checks: spec.sub_checks,
  };
}

export async function runStorylineAgent(
  ctx: AgentContext,
  config: StorylineConfig = resolveStorylineConfig(ctx),
): Promise<MetricResult[]> {
  const formatCheck = formatNoncompliant(
    ctx.video_metadata,
    config.platformSpec,
  );

  let response: StorylineUnifiedResponse | null = null;

  try {
    const rawText = await chat(unifiedStorylinePrompt(ctx, config.arcExpectation));
    response = safeParseJson(rawText, StorylineUnifiedResponseSchema);
  } catch (err) {
    // Single-call failure/timeout fallback protection: degrades LLM checks to cannot_assess
    console.error(
      `[${AGENT_NAME}] Unified LLM evaluation failed — degrading to cannot_assess:`,
      err instanceof Error ? err.message : err,
    );
  }

  const arc: ArcLabeling | null = response
    ? {
      arc: response.arc,
      unfilled_roles: response.unfilled_roles,
      payoff_resolved_at: response.payoff_resolved_at,
      overall_confidence: response.overall_confidence,
    }
    : null;

  const sparse = isSparseAnalysis(ctx, arc);
  const channel = buildChannelReadiness(formatCheck, response, sparse);
  const creative = buildCreativeEffectiveness(config, arc, response, sparse);

  return validateMetricResults([channel, creative]);
}

export function buildChannelReadiness(
  formatCheck: SubCheckResult,
  evaluation: StorylineUnifiedResponse | null,
  sparse: boolean,
): MetricResult {
  const byId = indexSubChecks(evaluation);

  const missingReason = evaluation === null
    ? "Evaluation call did not return a usable result."
    : "Sub-check was not returned by the evaluation call.";

  const rawPlacement = fromLlmSubCheck(
    byId.get(PLACEMENT_MISMATCH.id),
    PLACEMENT_MISMATCH.id,
    PLACEMENT_MISMATCH.name,
    PLACEMENT_MISMATCH.max,
    missingReason,
  );

  const cappedSeverity = clampSeverity(rawPlacement.severity, "low");
  const capApplied = sparse && rawPlacement.result === "failed" &&
    cappedSeverity !== rawPlacement.severity;

  const placement = capApplied
    ? failed(
      PLACEMENT_MISMATCH.id,
      PLACEMENT_MISMATCH.name,
      "low",
      `${rawPlacement.explanation ?? ""} (Severity capped to low: the analysis ` +
        `input is too sparse to judge platform/visual fit confidently.)`.trim(),
    )
    : rawPlacement;

  const subChecks = [formatCheck, placement];
  const derived = narrativeFromFailedChecks(subChecks);

  let fields: MetricLevelFields;
  if (formatCheck.result === "failed") {
    fields = {
      confidence: "high",
      evidence: derived?.evidence,
      explanation: formatCheck.explanation,
      suggested_correction:
        "Reformat the asset to meet the destination platform's technical spec.",
      correction_type: "edit_recommendation",
    };
  } else if (placement.result === "failed") {
    fields = {
      confidence: capApplied ? "low" : (evaluation?.confidence ?? "medium"),
      evidence: derived?.evidence,
      explanation: placement.explanation,
      suggested_correction:
        "Adjust the creative's tone and message to fit the placement and the target audience.",
      correction_type: "edit_recommendation",
    };
  } else if (
    formatCheck.result === "cannot_assess" &&
    placement.result === "cannot_assess"
  ) {
    fields = { explanation: formatCheck.explanation };
  } else {
    fields = { confidence: "high" };
  }

  return assembleMetric({
    metric_id: CHANNEL_METRIC.metric_id,
    metric_name: CHANNEL_METRIC.metric_name,
    question: CHANNEL_METRIC.question,
    sub_checks: subChecks,
    fields,
  });
}

export function buildCreativeEffectiveness(
  config: StorylineConfig,
  arc: ArcLabeling | null,
  evaluation: StorylineUnifiedResponse | null,
  sparse: boolean,
): MetricResult {
  const byId = indexSubChecks(evaluation);

  const missingReason = evaluation === null
    ? "Evaluation call did not return a usable result."
    : "Sub-check was not returned by the evaluation call.";

  const hook = fromLlmSubCheck(
    byId.get("hook_missing"),
    "hook_missing",
    LLM_CHECKS.hook_missing.name,
    LLM_CHECKS.hook_missing.max,
    missingReason,
  );

  const gap = fromLlmSubCheck(
    byId.get("narrative_gap"),
    "narrative_gap",
    LLM_CHECKS.narrative_gap.name,
    LLM_CHECKS.narrative_gap.max,
    missingReason,
  );

  const value = fromLlmSubCheck(
    byId.get("value_prop_unclear"),
    "value_prop_unclear",
    LLM_CHECKS.value_prop_unclear.name,
    LLM_CHECKS.value_prop_unclear.max,
    missingReason,
  );

  const story = config.arcExpectation !== null
    ? fromLlmSubCheck(
      byId.get("story_incomplete"),
      "story_incomplete",
      LLM_CHECKS.story_incomplete.name,
      LLM_CHECKS.story_incomplete.max,
      missingReason,
    )
    : cannotAssess(
      "story_incomplete",
      LLM_CHECKS.story_incomplete.name,
      "duration-based arc-expectation table not yet populated",
    );

  const storyReconciled = reconcileStoryIncomplete(
    story,
    arc,
    config.arcExpectation,
    sparse,
  );

  const pacing = fromLlmSubCheck(
    byId.get("pacing_misallocation"),
    "pacing_misallocation",
    LLM_CHECKS.pacing_misallocation.name,
    LLM_CHECKS.pacing_misallocation.max,
    missingReason,
  );

  const subChecks = [hook, gap, value, storyReconciled, pacing];

  let confidence = evaluation?.confidence ?? "low";
  if (arc?.overall_confidence === "low") confidence = "low";

  const derived = narrativeFromFailedChecks(subChecks);
  const modelEvidence = coerceEvidence(evaluation?.evidence);
  const modelExplanation = evaluation?.explanation?.trim()
    ? evaluation.explanation
    : undefined;

  const fields: MetricLevelFields = {
    confidence,
    evidence: modelEvidence && modelEvidence.length > 0
      ? modelEvidence
      : derived?.evidence,
    explanation: modelExplanation ??
      derived?.explanation ??
      (evaluation === null
        ? "The evaluation call did not return a usable result."
        : undefined),
    suggested_correction: evaluation?.suggested_correction,
    correction_type: evaluation
      ? coerceCorrectionType(evaluation.correction_type)
      : undefined,
  };

  return assembleMetric({
    metric_id: CREATIVE_METRIC.metric_id,
    metric_name: CREATIVE_METRIC.metric_name,
    question: CREATIVE_METRIC.question,
    sub_checks: subChecks,
    fields,
  });
}
