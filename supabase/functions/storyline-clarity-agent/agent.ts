/**
 * agent.ts — Storyline Clarity Agent orchestration.
 *
 * Owns two metrics: channel_readiness (single deterministic sub-check) and
 * creative_effectiveness (five LLM sub-checks). Flow: run the two-call LLM flow
 * (arc derivation → combined evaluation), run the deterministic format check in
 * code, and roll up into exactly TWO metric_results. Always returns both rows —
 * on total LLM failure the LLM-derived checks degrade to cannot_assess while the
 * deterministic format check still stands. pacing_misallocation is LLM-judged:
 * the AgentContext exposes point-in-time visual_frames with no scene durations to
 * sum, so there is no deterministic pacing math.
 */

import type {
  AgentContext,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";
import type { LlmClient } from "../shared/llm_client.ts";
import { runTwoCall, type TwoCallFlow } from "../shared/two_call.ts";
import { safeParseJson } from "../shared/llm_json.ts";
import { assembleMetric, type MetricLevelFields } from "../shared/metric.ts";
import { cannotAssess } from "../shared/subcheck.ts";
import {
  coerceCorrectionType,
  coerceEvidence,
  fromLlmSubCheck,
  indexSubChecks,
} from "../shared/llm_eval.ts";
import {
  getArcExpectation,
  getPlatformSpec,
  type PlatformSpec,
} from "../shared/config/index.ts";
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
    "Does the video fit the intended platform, placement, length, and viewing context?",
};
const CREATIVE = {
  metric_id: "creative_effectiveness" as const,
  metric_name: "Creative Effectiveness Basics",
  question:
    "Does the ad have a clear hook, coherent message flow, and enough stopping power?",
};
const AGENT = "storyline_clarity" as const;

/** LLM sub-check ids, display names, and allowed severity ceiling. */
const LLM_CHECKS = {
  hook_missing: { name: "Hook Presence Check", max: "critical" as const },
  narrative_gap: { name: "Narrative Gap Check", max: "high" as const },
  value_prop_unclear: { name: "Value Prop Check", max: "medium" as const },
  story_incomplete: { name: "Story Completion", max: "medium" as const },
  pacing_misallocation: { name: "Pacing Allocation", max: "medium" as const },
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
    buildChannelReadiness(formatCheck),
    buildCreativeEffectiveness(config, arc, evaluation),
  ];
}

function buildChannelReadiness(formatCheck: SubCheckResult): MetricResult {
  let fields: MetricLevelFields;
  if (formatCheck.result === "failed") {
    fields = {
      confidence: "high",
      explanation: formatCheck.explanation,
      suggested_correction:
        "Reformat the asset to meet the destination platform's technical spec.",
      correction_type: "edit_recommendation",
    };
  } else if (formatCheck.result === "cannot_assess") {
    fields = { explanation: formatCheck.explanation };
  } else {
    fields = { confidence: "high" };
  }
  return assembleMetric({
    metric_id: CHANNEL.metric_id,
    agent: AGENT,
    metric_name: CHANNEL.metric_name,
    question: CHANNEL.question,
    sub_checks: [formatCheck],
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
