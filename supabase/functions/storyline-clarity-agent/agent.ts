/**
 * agent.ts — Storyline Clarity Agent orchestration.
 *
 * Owns two metrics: channel_readiness (deterministic format check + LLM
 * placement/audience-fit check) and creative_effectiveness (five LLM sub-checks).
 * Flow: run the two-call LLM flow (arc derivation → combined evaluation), run the
 * deterministic format check in code, and roll up into exactly TWO metric_results.
 * Always returns both rows — on total LLM failure the LLM-derived checks degrade to
 * cannot_assess while the deterministic format check still stands.
 * pacing_misallocation is LLM-judged:
 * the AgentContext exposes point-in-time visual_frames with no scene durations to
 * sum, so there is no deterministic pacing math.
 */

import type {
  AgentContext,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";
import type { LlmClient } from "../shared/evaluator/llm_client.ts";
import { runTwoCall, type TwoCallFlow } from "../shared/evaluator/two_call.ts";
import { safeParseJson } from "../shared/llm_json.ts";
import { assembleMetric, type MetricLevelFields } from "../shared/evaluator/metric.ts";
import { cannotAssess } from "../shared/evaluator/subcheck.ts";
import {
  coerceCorrectionType,
  coerceEvidence,
  fromLlmSubCheck,
  indexSubChecks,
} from "../shared/evaluator/llm_eval.ts";
import { getArcExpectation } from "../shared/evaluator/config/index.ts";
import { getPlatformSpec, type PlatformSpec } from "../shared/config/index.ts";
import {
  type ArcLabeling,
  ArcLabelingSchema,
  type StorylineEvaluation,
  StorylineEvaluationSchema,
} from "./response_schemas.ts";
import { derivationPrompt, evaluationPrompt } from "./prompts.ts";
import { formatNoncompliant } from "./checks.ts";

const CHANNEL = {
  metric_id: "channel_readiness" as const,
  metric_name: "Channel / Placement Readiness",
  question:
    "Is the video fully appropriate for the intended platform, placement, duration, viewing context, and target audience needs/motivations?",
};
const CREATIVE = {
  metric_id: "creative_effectiveness" as const,
  metric_name: "Creative Effectiveness Basics",
  question:
    "Does the ad have a clear hook, coherent message flow, and enough stopping power?",
};
const AGENT = "storyline_clarity" as const;

/** creative_effectiveness LLM sub-check ids, display names, and severity ceiling. */
const LLM_CHECKS = {
  hook_missing: { name: "Hook Presence Check", max: "critical" as const },
  narrative_gap: { name: "Narrative Gap Check", max: "high" as const },
  value_prop_unclear: { name: "Value Prop Check", max: "medium" as const },
  story_incomplete: { name: "Story Completion", max: "medium" as const },
  pacing_misallocation: { name: "Pacing Allocation", max: "medium" as const },
};

/**
 * channel_readiness LLM sub-check: placement/audience appropriateness (tone,
 * message, pacing, use-case fit for the platform and target audience). It
 * complements the deterministic format_noncompliant technical check. Not
 * config-gated — it degrades to cannot_assess only when the evaluation call is
 * unavailable or the model abstains (e.g. no audience brief to judge against).
 */
const PLACEMENT_MISMATCH = {
  id: "placement_mismatch" as const,
  name: "Placement & Audience Fit",
  max: "high" as const,
};

export type StorylineConfig = {
  platformSpec: PlatformSpec | null;
  arcExpectationPresent: boolean; // gates story_incomplete
};

export function resolveStorylineConfig(ctx: AgentContext): StorylineConfig {
  return {
    platformSpec: getPlatformSpec(ctx.destination_platform),
    arcExpectationPresent:
      getArcExpectation(ctx.video_metadata.duration_ms) !== null,
  };
}

function storylineFlow(): TwoCallFlow<
  AgentContext,
  ArcLabeling | null,
  StorylineEvaluation | null
> {
  return {
    derivationPrompt: (ctx) => derivationPrompt(ctx),
    parseDerivation: (raw) => safeParseJson(raw, ArcLabelingSchema),
    evaluationPrompt: (ctx, arc) => evaluationPrompt(ctx, arc),
    parseEvaluation: (raw) => safeParseJson(raw, StorylineEvaluationSchema),
  };
}

export async function runStorylineAgent(
  ctx: AgentContext,
  llm: LlmClient,
  config: StorylineConfig = resolveStorylineConfig(ctx),
): Promise<MetricResult[]> {
  // Deterministic and independent of the LLM — always computable.
  const formatCheck = formatNoncompliant(
    ctx.video_metadata,
    config.platformSpec,
  );

  let arc: ArcLabeling | null = null;
  let evaluation: StorylineEvaluation | null = null;
  try {
    const out = await runTwoCall(llm, storylineFlow(), ctx);
    arc = out.derivation;
    evaluation = out.evaluation;
  } catch {
    // Total LLM failure: LLM-derived checks degrade to cannot_assess below.
  }

  return [
    buildChannelReadiness(formatCheck, evaluation),
    buildCreativeEffectiveness(config, arc, evaluation),
  ];
}

/**
 * channel_readiness rolls up two sub-checks: the deterministic format_noncompliant
 * (technical spec) and the LLM placement_mismatch (appropriateness for the platform
 * and audience). Metric-level fields surface the format failure first (a technical
 * blocker), then a placement failure; the sub_checks list carries both regardless.
 */
function buildChannelReadiness(
  formatCheck: SubCheckResult,
  evaluation: StorylineEvaluation | null,
): MetricResult {
  const byId = indexSubChecks(evaluation);
  const missing = evaluation === null
    ? "Evaluation call did not return a usable result."
    : "Sub-check was not returned by the evaluation call.";

  const placement = fromLlmSubCheck(
    byId.get(PLACEMENT_MISMATCH.id),
    PLACEMENT_MISMATCH.id,
    PLACEMENT_MISMATCH.name,
    PLACEMENT_MISMATCH.max,
    missing,
  );

  const subChecks = [formatCheck, placement];

  // NOTE: channel_readiness deliberately builds its own metric-level fields
  // instead of reusing evaluation.explanation / evaluation.suggested_correction.
  // Those envelope-level fields belong to creative_effectiveness — Call 2 is
  // prompted to summarize the storytelling, and placement_mismatch is only a
  // guest sub-check riding in that same reply. Copying the shared narrative here
  // would put storytelling prose on the channel row. format_noncompliant is also
  // deterministic (computed in code), so the LLM's narrative never describes it.
  //
  // TODO: this is the only metric that (a) mixes a deterministic + an LLM check
  // and (b) borrows a sub-check from another metric's envelope, which is why the
  // headline is synthesized positionally below (format first, then placement)
  // rather than from the model. Two known limitations to revisit if more
  // shared-envelope metrics appear:
  //   1. The positional order can diverge from the worst-wins `severity` (e.g. a
  //      low-severity format failure headlines while a high-severity placement
  //      failure sets severity). Consider selecting by highest severityRank.
  //   2. If Call 2 ever needs to emit a placement-specific narrative/correction,
  //      give the envelope per-metric fields (or split placement into its own
  //      call) instead of one shared explanation/suggested_correction.
  let fields: MetricLevelFields;
  if (formatCheck.result === "failed") {
    fields = {
      confidence: "high",
      explanation: formatCheck.explanation,
      suggested_correction:
        "Reformat the asset to meet the destination platform's technical spec.",
      correction_type: "edit_recommendation",
    };
  } else if (placement.result === "failed") {
    fields = {
      confidence: evaluation?.confidence ?? "medium",
      explanation: placement.explanation,
      suggested_correction:
        "Adjust the creative's tone, message, or pacing to fit the placement and the target audience.",
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
    metric_id: CHANNEL.metric_id,
    agent: AGENT,
    metric_name: CHANNEL.metric_name,
    question: CHANNEL.question,
    sub_checks: subChecks,
    fields,
  });
}

function buildCreativeEffectiveness(
  config: StorylineConfig,
  arc: ArcLabeling | null,
  evaluation: StorylineEvaluation | null,
): MetricResult {
  const byId = indexSubChecks(evaluation);
  const missing = evaluation === null
    ? "Evaluation call did not return a usable result."
    : "Sub-check was not returned by the evaluation call.";

  const hook = fromLlmSubCheck(
    byId.get("hook_missing"),
    "hook_missing",
    LLM_CHECKS.hook_missing.name,
    LLM_CHECKS.hook_missing.max,
    missing,
  );
  const gap = fromLlmSubCheck(
    byId.get("narrative_gap"),
    "narrative_gap",
    LLM_CHECKS.narrative_gap.name,
    LLM_CHECKS.narrative_gap.max,
    missing,
  );
  const value = fromLlmSubCheck(
    byId.get("value_prop_unclear"),
    "value_prop_unclear",
    LLM_CHECKS.value_prop_unclear.name,
    LLM_CHECKS.value_prop_unclear.max,
    missing,
  );

  // story_incomplete is gated on the arc-expectation table: cannot_assess until populated.
  const story = config.arcExpectationPresent
    ? fromLlmSubCheck(
      byId.get("story_incomplete"),
      "story_incomplete",
      LLM_CHECKS.story_incomplete.name,
      LLM_CHECKS.story_incomplete.max,
      missing,
    )
    : cannotAssess(
      "story_incomplete",
      LLM_CHECKS.story_incomplete.name,
      "duration-based arc-expectation table not yet populated",
    );

  // pacing_misallocation: LLM-judged (no scene durations to sum in AgentContext).
  const pacing = fromLlmSubCheck(
    byId.get("pacing_misallocation"),
    "pacing_misallocation",
    LLM_CHECKS.pacing_misallocation.name,
    LLM_CHECKS.pacing_misallocation.max,
    missing,
  );

  const subChecks = [hook, gap, value, story, pacing];

  // Low arc confidence must not become a confident pass (spec p.5): cap confidence.
  let confidence = evaluation?.confidence ?? "low";
  if (arc?.overall_confidence === "low") confidence = "low";

  const fields: MetricLevelFields = {
    confidence,
    evidence: coerceEvidence(evaluation?.evidence),
    explanation: evaluation?.explanation ??
      (evaluation === null
        ? "The evaluation call did not return a usable result."
        : undefined),
    suggested_correction: evaluation?.suggested_correction,
    correction_type: evaluation
      ? coerceCorrectionType(evaluation.correction_type)
      : undefined,
  };

  return assembleMetric({
    metric_id: CREATIVE.metric_id,
    agent: AGENT,
    metric_name: CREATIVE.metric_name,
    question: CREATIVE.question,
    sub_checks: subChecks,
    fields,
  });
}
