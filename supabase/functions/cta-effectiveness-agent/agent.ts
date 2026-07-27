/**
 * agent.ts — CTA Effectiveness Agent orchestration.
 *
 * Owns one metric: cta_clarity, rolled up from nine sub-checks — four
 * deterministic (cta_buried, cta_mistimed, cta_low_visibility,
 * cta_platform_mismatch) and five LLM (cta_absent, cta_language_weak,
 * cta_goal_mismatch, cta_no_urgency, cta_destination_unclear). Flow: exactly two
 * LLM calls — Call 1 acquires the canonical CTA list (so absence is never
 * inferred from an empty detected_ctas[]), then Call 2 judges the LLM checks
 * against the resolved goal benchmark; the deterministic checks run in code, and
 * everything rolls up into ONE metric_result. Special handling: cta_absent's
 * severity is goal-conditional, and cta_no_urgency only applies to conversion
 * goals. CTAs are derived from transcript/OCR in Call 1 (there is no
 * detected_ctas primitive), each carrying numeric start_ms/end_ms that the
 * deterministic positional checks operate on.
 */

import { chat } from "../shared/llm.ts";
import type {
  AgentContext,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";
import {
  cannotAssess,
  CTA_ABSENT_SEVERITY,
  ctaBuried,
  ctaLowVisibility,
  ctaMistimed,
  ctaPlatformMismatch,
  failed,
  passed,
  severityRank,
} from "./checks.ts";
import {
  type CtaTiming,
  type CtaVisibilityThresholds,
  getCtaTiming,
  getCtaVisibilityThresholds,
  getGoalBenchmark,
  getPlatformPhrasing,
  type PlatformPhrasing,
} from "./config.ts";
import {
  coerceCorrectionType,
  coerceEvidence,
  type CtaAcquisition,
  CtaAcquisitionSchema,
  type CtaEvaluation,
  CtaEvaluationSchema,
  fromLlmSubCheck,
  indexSubChecks,
  safeParseJson,
} from "./response_schemas.ts";
import { acquisitionPrompt, evaluationPrompt } from "./prompts.ts";

const CTA = {
  metric_id: "cta_clarity" as const,
  metric_name: "CTA Clarity",
  question: "Is there a clear and appropriate next step for the viewer?",
};
const AGENT = "cta_effectiveness" as const;

const NAMES = {
  cta_absent: "CTA Presence",
  cta_language_weak: "CTA Phrasing Check",
  cta_goal_mismatch: "CTA Goal Alignment",
  cta_no_urgency: "CTA Urgency Check",
  cta_destination_unclear: "CTA Destination Check",
};

export type CtaConfig = {
  timing: CtaTiming | null;
  visibility: CtaVisibilityThresholds | null;
  phrasing: PlatformPhrasing | null;
  goalBenchmarkPresent: boolean; // gates cta_goal_mismatch
};

export function resolveCtaConfig(ctx: AgentContext): CtaConfig {
  return {
    timing: getCtaTiming(),
    visibility: getCtaVisibilityThresholds(),
    phrasing: getPlatformPhrasing(ctx.destination_platform),
    goalBenchmarkPresent: getGoalBenchmark(ctx.campaign_goal) !== null,
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

/**
 * Worst-wins rollup: the metric fails if any sub-check failed (severity = the
 * highest among the failures); passes if at least one sub-check is assessable
 * and none failed; cannot_assess only when every sub-check is cannot_assess (or
 * there are none). Judged on the assessable sub-checks alone.
 */
export function rollup(
  subChecks: readonly SubCheckResult[],
): { result: MetricResult["result"]; severity: SeverityLevel } {
  const failedChecks = subChecks.filter((c) => c.result === "failed");
  if (failedChecks.length > 0) {
    const severity = failedChecks.reduce<SeverityLevel>(
      (worst, c) =>
        severityRank(c.severity) > severityRank(worst) ? c.severity : worst,
      "none",
    );
    return { result: "false", severity };
  }
  if (subChecks.some((c) => c.result === "passed")) {
    return { result: "true", severity: "none" };
  }
  return { result: "cannot_assess", severity: "cannot_assess" };
}

/** Assemble a MetricResult from its sub-checks (rolled up) + metric-level fields. */
function assembleMetric(spec: {
  sub_checks: SubCheckResult[];
  fields?: MetricLevelFields;
}): MetricResult {
  const { result, severity } = rollup(spec.sub_checks);
  return {
    metric_id: CTA.metric_id,
    agent: AGENT,
    metric_name: CTA.metric_name,
    question: CTA.question,
    result,
    severity,
    ...spec.fields,
    sub_checks: spec.sub_checks,
  };
}

export async function runCtaAgent(
  ctx: AgentContext,
  config: CtaConfig = resolveCtaConfig(ctx),
): Promise<MetricResult[]> {
  // Exactly two LLM calls: Call 1 acquires the CTA list, Call 2 evaluates it.
  let acquisition: CtaAcquisition | null = null;
  let evaluation: CtaEvaluation | null = null;
  try {
    const acqRaw = await chat(acquisitionPrompt(ctx));
    acquisition = safeParseJson(acqRaw, CtaAcquisitionSchema);
    const evalRaw = await chat(
      evaluationPrompt(ctx, acquisition, getGoalBenchmark(ctx.campaign_goal)),
    );
    evaluation = safeParseJson(evalRaw, CtaEvaluationSchema);
  } catch {
    // Total LLM failure: everything degrades to cannot_assess below.
  }

  return [buildCtaClarity(ctx, config, acquisition, evaluation)];
}

export function buildCtaClarity(
  ctx: AgentContext,
  config: CtaConfig,
  acquisition: CtaAcquisition | null,
  evaluation: CtaEvaluation | null,
): MetricResult {
  // CTAs come from Call 1 (derived from transcript/OCR), each with numeric spans.
  const acquiredCtas = acquisition?.ctas ?? [];
  // Trust Call 1 for presence — it re-read transcript/OCR specifically to avoid
  // a false absence.
  const ctaPresent = acquisition?.cta_present ?? false;
  const canonicalTexts = acquiredCtas.map((c) => c.text);
  const byId = indexSubChecks(evaluation);
  const missing = evaluation === null
    ? "Evaluation call did not return a usable result."
    : "Sub-check was not returned by the evaluation call.";

  // Deterministic checks (config-gated).
  const buried = ctaBuried(acquiredCtas, config.timing);
  const mistimed = ctaMistimed(
    acquiredCtas,
    ctx.video_metadata.duration_ms,
    config.timing,
  );
  const lowVis = ctaLowVisibility(
    acquiredCtas,
    ctx.ocr_segments,
    config.visibility,
  );
  const platform = ctaPlatformMismatch(canonicalTexts, config.phrasing);

  // LLM checks.
  const languageWeak = fromLlmSubCheck(
    byId.get("cta_language_weak"),
    "cta_language_weak",
    NAMES.cta_language_weak,
    "medium",
    missing,
  );
  const destination = fromLlmSubCheck(
    byId.get("cta_destination_unclear"),
    "cta_destination_unclear",
    NAMES.cta_destination_unclear,
    "medium",
    missing,
  );

  // cta_goal_mismatch: gated on the goal→CTA-type benchmark table.
  const goalMismatch = config.goalBenchmarkPresent
    ? fromLlmSubCheck(
      byId.get("cta_goal_mismatch"),
      "cta_goal_mismatch",
      NAMES.cta_goal_mismatch,
      "high",
      missing,
    )
    : cannotAssess(
      "cta_goal_mismatch",
      NAMES.cta_goal_mismatch,
      "goal→CTA-type benchmark table not yet populated",
    );

  // cta_no_urgency: goal-scoped. Only fires on a conversion goal; otherwise it
  // passes with severity none (an awareness ad with no urgency is behaving right).
  const noUrgency = ctx.campaign_goal === "conversion"
    ? fromLlmSubCheck(
      byId.get("cta_no_urgency"),
      "cta_no_urgency",
      NAMES.cta_no_urgency,
      "low",
      missing,
    )
    : passed("cta_no_urgency", NAMES.cta_no_urgency);

  // cta_absent: presence from Call 1 (corroborated by Call 2), severity goal-conditional.
  const absent = buildCtaAbsent(
    ctx.campaign_goal,
    acquisition,
    byId.get("cta_absent"),
    ctaPresent,
  );

  const subChecks: SubCheckResult[] = [
    absent,
    buried,
    mistimed,
    languageWeak,
    goalMismatch,
    noUrgency,
    destination,
    lowVis,
    platform,
  ];

  const fields: MetricLevelFields = {
    confidence: evaluation?.confidence ?? "low",
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

  return assembleMetric({ sub_checks: subChecks, fields });
}

/**
 * cta_absent — the highest-stakes finding. Presence is taken from Call 1 (which
 * re-reads transcript/OCR to catch implicit CTAs); if Call 1 is unavailable, the
 * Call 2 verdict is a fallback; if neither is usable, cannot_assess. When a CTA
 * is genuinely absent, severity is goal-conditional — and on an awareness goal a
 * CTA is optional, so absence passes with severity none rather than failing.
 */
function buildCtaAbsent(
  campaignGoal: string,
  acquisition: CtaAcquisition | null,
  call2Verdict: { result: "passed" | "failed" | "cannot_assess" } | undefined,
  ctaPresent: boolean,
): SubCheckResult {
  const id = "cta_absent";
  const name = NAMES.cta_absent;

  let present: boolean;
  if (acquisition !== null) {
    present = ctaPresent;
  } else if (
    call2Verdict !== undefined && call2Verdict.result !== "cannot_assess"
  ) {
    present = call2Verdict.result === "passed"; // passed = a CTA is present
  } else {
    return cannotAssess(
      id,
      name,
      "Neither CTA acquisition nor evaluation returned a usable presence signal.",
    );
  }

  if (present) return passed(id, name);

  const severity = CTA_ABSENT_SEVERITY[campaignGoal] ?? "medium";
  if (severity === "none") {
    // awareness: a CTA is optional, so its absence is acceptable, not a failure.
    return passed(id, name);
  }
  return failed(
    id,
    name,
    severity,
    `No CTA is present, which is a problem on a ${campaignGoal} campaign.`,
  );
}
