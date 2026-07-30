/**
 * agent.ts — Storyline Clarity Agent orchestration.
 *
 * Owns two metrics: channel_readiness (deterministic format check + LLM
 * placement/audience-fit check) and creative_effectiveness (five LLM sub-checks).
 * Flow: make exactly two LLM calls — Call 1 (arc derivation) then Call 2
 * (combined evaluation reading Call 1's output) — run the deterministic format
 * check in code, and roll up into exactly TWO metric_results. Always returns
 * both rows — on total LLM failure the LLM-derived checks degrade to
 * cannot_assess while the deterministic format check still stands.
 * pacing_misallocation is LLM-judged: the AgentContext exposes point-in-time
 * visual_frames with no scene durations to sum, so there is no deterministic
 * pacing math.
 */

import { chat } from "../shared/llm.ts";
import { rollupChecks } from "../shared/checks.ts";
import type {
  AgentContext,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";
import {
  cannotAssess,
  formatNoncompliant,
  narrativeFromFailedChecks,
  reconcileMetricCorrection,
} from "./checks.ts";
import {
  type ArcExpectation,
  getArcExpectation,
  getPlatformSpec,
  type PlatformSpec,
} from "./config.ts";
import {
  type ArcLabeling,
  ArcLabelingSchema,
  coerceCorrectionType,
  coerceEvidence,
  fromLlmSubCheck,
  indexSubChecks,
  safeParseJson,
  type StorylineEvaluation,
  StorylineEvaluationSchema,
} from "./response_schemas.ts";
import { derivationPrompt, evaluationPrompt } from "./prompts.ts";

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
 * channel_readiness LLM sub-check: placement/audience appropriateness — the
 * platform's format and style conventions, the viewing context, and whether the
 * content fits (vs. alienates) the target audience. Scoped deliberately to
 * placement-level fit: internal craft (hook, pacing, narrative, value prop) is
 * creative_effectiveness's job (sub-checks 1–5) and is NOT re-graded here. It
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
  /**
   * The duration-bucket arc expectation for this ad. Null gates story_incomplete
   * to cannot_assess; when present, its expected_roles + expect_payoff_resolved
   * are threaded into the Call 2 prompt so story_incomplete grades against them.
   */
  arcExpectation: ArcExpectation | null;
};

export function resolveStorylineConfig(ctx: AgentContext): StorylineConfig {
  return {
    platformSpec: getPlatformSpec(ctx.destination_platform),
    arcExpectation: getArcExpectation(ctx.video_metadata.duration_ms),
  };
}

/** Metric-level fields attached to a MetricResult on top of its rolled-up verdict. */
export type MetricLevelFields = {
  confidence?: MetricResult["confidence"];
  evidence?: MetricResult["evidence"];
  explanation?: string;
  suggested_correction?: string;
  correction_type?: MetricResult["correction_type"];
};

/** Assemble a MetricResult from its sub-checks (rolled up) + metric-level fields. */
function assembleMetric(spec: {
  metric_id: MetricResult["metric_id"];
  metric_name: string;
  question: string;
  sub_checks: SubCheckResult[];
  fields?: MetricLevelFields;
}): MetricResult {
  const { result, severity } = rollupChecks(spec.sub_checks);
  // Correction only makes sense for a genuine failure; a pass or an unassessable
  // metric is forced to correction_type "none" (see reconcileMetricCorrection).
  const correction = reconcileMetricCorrection(result, spec.fields ?? {});
  return {
    metric_id: spec.metric_id,
    agent: AGENT,
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
  // Deterministic and independent of the LLM — always computable.
  const formatCheck = formatNoncompliant(
    ctx.video_metadata,
    config.platformSpec,
  );

  // Exactly two LLM calls: Call 1 derives the arc, Call 2 evaluates reading it.
  let arc: ArcLabeling | null = null;
  let evaluation: StorylineEvaluation | null = null;
  try {
    const arcRaw = await chat(derivationPrompt(ctx));
    arc = safeParseJson(arcRaw, ArcLabelingSchema);
    const evalRaw = await chat(
      evaluationPrompt(ctx, arc, config.arcExpectation),
    );
    evaluation = safeParseJson(evalRaw, StorylineEvaluationSchema);
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
export function buildChannelReadiness(
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
  // Evidence for a channel failure comes from this metric's OWN failed sub-checks
  // (format_noncompliant / placement_mismatch), not the creative narrative — same
  // mechanical reuse as creative_effectiveness. Without it a failing channel row
  // persists evidence-less (persist.ts fills agent_result_evidence from metric.evidence).
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
      confidence: evaluation?.confidence ?? "medium",
      evidence: derived?.evidence,
      explanation: placement.explanation,
      // Channel-fit correction only — pacing/hook/narrative are creative_effectiveness's
      // to correct, so this row does not suggest craft edits.
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
    metric_id: CHANNEL.metric_id,
    metric_name: CHANNEL.metric_name,
    question: CHANNEL.question,
    sub_checks: subChecks,
    fields,
  });
}

export function buildCreativeEffectiveness(
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
  const story = config.arcExpectation !== null
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

  // When the metric fails but the LLM left the metric-level evidence/explanation
  // blank, fall back to the failed sub-checks' own explanations so the result is
  // never persisted with no metric-level evidence. (undefined on a pass.)
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
    metric_id: CREATIVE.metric_id,
    metric_name: CREATIVE.metric_name,
    question: CREATIVE.question,
    sub_checks: subChecks,
    fields,
  });
}
