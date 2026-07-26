/**
 * visual-quality-agent/metrics.ts — Production readiness synthesis.
 *
 * Converts the six internal production-quality checks into the final
 * public MetricResult for the production_readiness metric.
 *
 * This module is deterministic and is the source of truth for:
 * - overall pass/fail/cannot_assess result,
 * - overall severity,
 * - confidence,
 * - evidence selection,
 * - explanation,
 * - suggested correction,
 * - correction type,
 * - and sub-check output.
 *
 * The LLM does not determine the final production-readiness score.
 * The highest-severity failed check determines the overall severity.
 */

import type {
  AgentContext,
  EvidenceRef,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";

import type {
  ProductionReadinessChecks,
  SeverityScore,
} from "./types.ts";

import {
  confidenceBucket,
  msToTimestamp,
  severityFromScore,
  worstSeverity,
} from "./utils.ts";

export function evaluateProductionReadiness(
  context: AgentContext,
  checks: ProductionReadinessChecks,
): MetricResult {
  const allChecks = Object.values(checks);

  const failedChecks = allChecks.filter(
    (check) => check.result === "failed",
  );

  const cannotAssessChecks = allChecks.filter(
    (check) => check.result === "cannot_assess",
  );

  const overallSeverityScore = worstSeverity(
    failedChecks.map((check) => check.severityScore),
  );

  const result = determineOverallResult(
    allChecks,
    failedChecks,
    cannotAssessChecks,
  );

  const confidenceScore = calculateOverallConfidence(
    allChecks,
    failedChecks,
    cannotAssessChecks,
  );

  const evidence = collectEvidence(
    failedChecks,
    overallSeverityScore,
  );

  const subChecks: SubCheckResult[] = allChecks.map((check) => ({
    check_id: check.check_id,
    name: check.name,
    result: check.result,
    severity: severityFromScore(check.severityScore),
    ...(check.explanation
      ? { explanation: check.explanation }
      : {}),
  }));

  const correction = buildCorrection(
    failedChecks,
    overallSeverityScore,
  );

  return {
    metric_id: "production_readiness",
    agent: "visual_quality",
    metric_name: "Production / Asset Readiness",
    question:
      "Is the video technically complete enough to be reviewed or launched?",
    result,
    severity:
      result === "cannot_assess"
        ? "cannot_assess"
        : severityFromScore(overallSeverityScore),
    confidence: confidenceBucket(confidenceScore),
    ...(evidence.length > 0 ? { evidence } : {}),
    explanation: buildExplanation(
      context,
      failedChecks,
      cannotAssessChecks,
      overallSeverityScore,
    ),
    suggested_correction: correction.text,
    correction_type: correction.type,
    sub_checks: subChecks,
  };
}

function determineOverallResult(
  allChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  failedChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  cannotAssessChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
): "true" | "false" | "cannot_assess" {
  if (failedChecks.length > 0) {
    return "false";
  }

  if (cannotAssessChecks.length > 0) {
    return "cannot_assess";
  }

  if (allChecks.length === 0) {
    return "cannot_assess";
  }

  return "true";
}

function calculateOverallConfidence(
  allChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  failedChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  cannotAssessChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
): number {
  if (allChecks.length === 0) {
    return 0;
  }

  if (cannotAssessChecks.length === allChecks.length) {
    return 0;
  }

  const relevantChecks =
    failedChecks.length > 0
      ? failedChecks
      : allChecks.filter(
          (check) => check.result !== "cannot_assess",
        );

  if (relevantChecks.length === 0) {
    return 0;
  }

  const average =
    relevantChecks.reduce(
      (sum, check) => sum + check.confidence_score,
      0,
    ) / relevantChecks.length;

  // Missing checks reduce confidence.
  const completeness =
    (allChecks.length - cannotAssessChecks.length) /
    allChecks.length;

  return Math.min(1, average * completeness);
}

function collectEvidence(
  failedChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  overallSeverityScore: SeverityScore,
): EvidenceRef[] {
  if (failedChecks.length === 0) {
    return [];
  }

  const highestSeverityChecks = failedChecks.filter(
    (check) => check.severityScore === overallSeverityScore,
  );

  const sourceChecks =
    highestSeverityChecks.length > 0
      ? highestSeverityChecks
      : failedChecks;

  return sourceChecks
    .filter((check) => check.evidence)
    .map((check) => check.evidence!)
    .slice(0, 5);
}

function buildExplanation(
  _context: AgentContext,
  failedChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  cannotAssessChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  overallSeverityScore: SeverityScore,
): string {
  if (failedChecks.length === 0 && cannotAssessChecks.length === 0) {
    return "No material production-quality issues were detected across the evaluated technical, visual, transition, framing, lighting, and text-quality checks.";
  }

  if (failedChecks.length === 0 && cannotAssessChecks.length > 0) {
    const names = cannotAssessChecks
      .map((check) => check.name)
      .join(", ");

    return `The video passed all checks that could be assessed, but production readiness could not be fully determined because the following checks could not be assessed: ${names}.`;
  }

  const issues = failedChecks
    .map((check) => check.explanation)
    .filter(Boolean);

  const severity = severityFromScore(overallSeverityScore);

  return `Production readiness is ${severity} due to the following detected issue${issues.length === 1 ? "" : "s"}: ${issues.join(" ")}`;
}

function buildCorrection(
  failedChecks: ProductionReadinessChecks[keyof ProductionReadinessChecks][],
  overallSeverityScore: SeverityScore,
): {
  text: string;
  type: "rewrite" | "edit_recommendation" | "technical_fix" | "none";
} {
  if (failedChecks.length === 0) {
    return {
      text: "No correction is required.",
      type: "none",
    };
  }

  const ids = new Set(
    failedChecks.map((check) => check.check_id),
  );

  if (ids.has("video_corruption")) {
    return {
      text:
        "Replace or repair the corrupted video asset and verify that the final file plays through to completion.",
      type: "technical_fix",
    };
  }

  if (ids.has("dropped_frames")) {
    return {
      text:
        "Re-export or re-encode the video using a stable frame rate and verify playback for stuttering or dropped frames.",
      type: "technical_fix",
    };
  }

  if (ids.has("ai_artifacts")) {
    return {
      text:
        "Regenerate or replace the affected visual sections and verify the corrected frames for morphing, distortion, ghosting, or other AI artifacts.",
      type: "edit_recommendation",
    };
  }

  if (ids.has("jarring_transitions")) {
    return {
      text:
        "Refine the affected scene transition by replacing problematic cuts, flash frames, or inconsistent color treatment.",
      type: "edit_recommendation",
    };
  }

  if (ids.has("poor_framing_lighting")) {
    return {
      text:
        "Adjust framing, exposure, lighting, or cropping so the primary subject remains clearly visible and consistently presented.",
      type: "edit_recommendation",
    };
  }

  if (ids.has("illegible_text")) {
    return {
      text:
        "Increase text size, contrast, display duration, or safe-area placement so on-screen text remains readable throughout its appearance.",
      type: "edit_recommendation",
    };
  }

  return {
    text:
      overallSeverityScore >= 3
        ? "Correct the major production-quality issues before launch."
        : "Review and correct the identified production-quality issues before final export.",
    type: "edit_recommendation",
  };
}