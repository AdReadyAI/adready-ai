/**
 * agent.ts — Pipeline orchestration for CTA Effectiveness Agent
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
  CTA_ABSENT_SEVERITY,
  ctaBuried,
  ctaLowVisibility,
  ctaMistimed,
  ctaPlatformMismatch,
  failed,
  matchesRequiredCta,
  narrativeFromFailedChecks,
  passed,
  reconcileMetricCorrection,
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

const CTA_METRIC = {
  metric_id: "cta_clarity" as const,
  metric_name: "CTA Clarity",
  question: "Is there a clear and appropriate next step for the viewer?",
};

const AGENT_NAME = "cta_effectiveness" as const;

const CHECK_NAMES = {
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
  goalBenchmarkPresent: boolean;
};

export function resolveCtaConfig(ctx: AgentContext): CtaConfig {
  return {
    timing: getCtaTiming(),
    visibility: getCtaVisibilityThresholds(),
    phrasing: getPlatformPhrasing(ctx.destination_platform),
    goalBenchmarkPresent: getGoalBenchmark(ctx.campaign_goal) !== null,
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
  sub_checks: SubCheckResult[];
  fields?: MetricLevelFields;
}): MetricResult {
  const { result, severity } = rollupChecks(spec.sub_checks);
  const correction = reconcileMetricCorrection(result, spec.fields ?? {});

  return {
    metric_id: CTA_METRIC.metric_id,
    agent: AGENT_NAME,
    metric_name: CTA_METRIC.metric_name,
    question: CTA_METRIC.question,
    result,
    severity,
    ...spec.fields,
    ...correction,
    sub_checks: spec.sub_checks,
  };
}

export async function runCtaAgent(
  ctx: AgentContext,
  config: CtaConfig = resolveCtaConfig(ctx),
): Promise<MetricResult[]> {
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
    // LLM calls degrade gracefully to cannot_assess for qualitative checks
  }

  const result = buildCtaClarity(ctx, config, acquisition, evaluation);
  return validateMetricResults([result]);
}

function capToBriefLow(check: SubCheckResult): SubCheckResult {
  if (check.result !== "failed") return check;
  if (clampSeverity(check.severity, "low") === check.severity) return check;

  return failed(
    check.check_id,
    check.name,
    "low",
    `${check.explanation ?? ""} (Severity capped to low: the CTA matches the ` +
      `brief's required CTA, so this phrasing is the advertiser's deliberate choice.)`
      .trim(),
  );
}

export function buildCtaClarity(
  ctx: AgentContext,
  config: CtaConfig,
  acquisition: CtaAcquisition | null,
  evaluation: CtaEvaluation | null,
): MetricResult {
  const acquiredCtas = acquisition?.ctas ?? [];
  const ctaPresent = acquisition?.cta_present ?? false;
  const canonicalTexts = acquiredCtas.map((c) => c.text);
  const byId = indexSubChecks(evaluation);

  const missingReason = evaluation === null
    ? "Evaluation call did not return a usable result."
    : "Sub-check was not returned by the evaluation call.";

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

  const languageWeak = fromLlmSubCheck(
    byId.get("cta_language_weak"),
    "cta_language_weak",
    CHECK_NAMES.cta_language_weak,
    "medium",
    missingReason,
  );

  const destination = fromLlmSubCheck(
    byId.get("cta_destination_unclear"),
    "cta_destination_unclear",
    CHECK_NAMES.cta_destination_unclear,
    "medium",
    missingReason,
  );

  const goalMismatch = config.goalBenchmarkPresent
    ? fromLlmSubCheck(
      byId.get("cta_goal_mismatch"),
      "cta_goal_mismatch",
      CHECK_NAMES.cta_goal_mismatch,
      "high",
      missingReason,
    )
    : cannotAssess(
      "cta_goal_mismatch",
      CHECK_NAMES.cta_goal_mismatch,
      "goal→CTA-type benchmark table not yet populated",
    );

  const noUrgency = ctx.campaign_goal === "conversion"
    ? fromLlmSubCheck(
      byId.get("cta_no_urgency"),
      "cta_no_urgency",
      CHECK_NAMES.cta_no_urgency,
      "low",
      missingReason,
    )
    : passed("cta_no_urgency", CHECK_NAMES.cta_no_urgency);

  const absent = buildCtaAbsent(
    ctx.campaign_goal,
    acquisition,
    byId.get("cta_absent"),
    ctaPresent,
  );

  const briefMatched = acquiredCtas.some((c) =>
    matchesRequiredCta(c.text, ctx.parsed_creative_brief.required_ctas)
  );

  const languageWeakFinal = briefMatched ? capToBriefLow(languageWeak) : languageWeak;
  const goalMismatchFinal = briefMatched ? capToBriefLow(goalMismatch) : goalMismatch;

  const subChecks: SubCheckResult[] = [
    absent,
    buried,
    mistimed,
    languageWeakFinal,
    goalMismatchFinal,
    noUrgency,
    destination,
    lowVis,
    platform,
  ];

  const derived = narrativeFromFailedChecks(subChecks);
  const modelEvidence = coerceEvidence(evaluation?.evidence);
  const modelExplanation = evaluation?.explanation?.trim()
    ? evaluation.explanation
    : undefined;

  const fields: MetricLevelFields = {
    confidence: evaluation?.confidence ?? "low",
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

  return assembleMetric({ sub_checks: subChecks, fields });
}

function buildCtaAbsent(
  campaignGoal: string,
  acquisition: CtaAcquisition | null,
  call2Verdict: { result: "passed" | "failed" | "cannot_assess" } | undefined,
  ctaPresent: boolean,
): SubCheckResult {
  const id = "cta_absent";
  const name = CHECK_NAMES.cta_absent;

  let present: boolean;
  if (acquisition !== null) {
    present = ctaPresent;
  } else if (
    call2Verdict !== undefined && call2Verdict.result !== "cannot_assess"
  ) {
    present = call2Verdict.result === "passed";
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
    return passed(id, name);
  }

  return failed(
    id,
    name,
    severity,
    `No CTA is present, which is a problem on a ${campaignGoal} campaign.`,
  );
}
