import type {
  AgentContext,
  EvidenceRef,
  MetricResult,
} from "../shared/schemas.ts";

import type {
  VisualAuditFinding,
} from "./visual-audit.ts";

type SeverityScore =
  0 | 1 | 2 | 3 | 4;

type ProductionCheckResult =
  | "passed"
  | "failed"
  | "cannot_assess";

type ProductionReadinessCheck = {
  check_id:
    | "video_corruption"
    | "dropped_frames"
    | "ai_artifacts"
    | "poor_framing_lighting"
    | "jarring_transitions"
    | "illegible_text";

  name: string;

  result:
    ProductionCheckResult;

  severityScore:
    SeverityScore;

  confidence_score:
    number;

  explanation?:
    string;

  evidence?:
    EvidenceRef;
};

type ProductionReadinessChecks = {
  video_corruption:
    ProductionReadinessCheck;

  dropped_frames:
    ProductionReadinessCheck;

  ai_artifacts:
    ProductionReadinessCheck;

  poor_framing_lighting:
    ProductionReadinessCheck;

  jarring_transitions:
    ProductionReadinessCheck;

  illegible_text:
    ProductionReadinessCheck;
};

/**
 * Evaluates all six production-readiness checks
 * and synthesizes the final MetricResult.
 */
export function evaluateProductionReadiness(
  context: AgentContext,
  visualFindings: VisualAuditFinding[],
): MetricResult {
  const checks =
    evaluateProductionChecks(
      context,
      visualFindings,
    );

  const allChecks =
    Object.values(checks);

  const failedChecks =
    allChecks.filter(
      (check) =>
        check.result ===
        "failed",
    );

  const cannotAssessChecks =
    allChecks.filter(
      (check) =>
        check.result ===
        "cannot_assess",
    );

  const result:
    MetricResult["result"] =
    failedChecks.length > 0
      ? "false"
      : cannotAssessChecks.length > 0
      ? "cannot_assess"
      : "true";

  const highestSeverity =
    failedChecks.reduce(
      (
        highest,
        check,
      ) =>
        Math.max(
          highest,
          check.severityScore,
        ),
      0,
    );

  const severity:
    MetricResult["severity"] =
    result ===
      "cannot_assess"
      ? "cannot_assess"
      : result === "true"
      ? "none"
      : severityFromScore(
          highestSeverity,
        );

  const confidenceValues =
    allChecks
      .filter(
        (check) =>
          check.result !==
          "cannot_assess",
      )
      .map(
        (check) =>
          check.confidence_score,
      );

  const averageConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce(
        (
          sum,
          confidence,
        ) =>
          sum + confidence,
        0,
      ) /
        confidenceValues.length
      : 0;

  const confidence =
    result ===
      "cannot_assess"
      ? averageConfidence >= 0.8
        ? "high"
        : averageConfidence >= 0.5
        ? "medium"
        : "low"
      : averageConfidence >= 0.8
      ? "high"
      : averageConfidence >= 0.5
      ? "medium"
      : "low";

  const evidence =
    allChecks
      .filter(
        (check) =>
          check.evidence !==
          undefined,
      )
      .map(
        (check) =>
          check.evidence!,
      );

  return {
    metric_id:
      "production_readiness",

    agent:
      "visual_quality",

    metric_name:
      "Production Readiness",

    question:
      "Is the video technically and visually ready for production?",

    result,

    severity,

    confidence,

    evidence:
      evidence.length > 0
        ? evidence
        : undefined,

    explanation:
      buildExplanation(
        result,
        failedChecks,
        cannotAssessChecks,
      ),

    suggested_correction:
      failedChecks.length > 0
        ? "Review and correct the failed production-readiness checks before launch."
        : undefined,

    correction_type:
      failedChecks.length > 0
        ? "technical_fix"
        : undefined,

    sub_checks:
      allChecks.map(
        (check) => ({
          check_id:
            check.check_id,

          name:
            check.name,

          result:
            check.result,

          severity:
            check.result ===
              "cannot_assess"
              ? "cannot_assess"
              : severityFromScore(
                check.severityScore,
              ),

          explanation:
            check.explanation,
        }),
      ),
  };
}

function evaluateProductionChecks(
  context: AgentContext,
  visualFindings: VisualAuditFinding[],
): ProductionReadinessChecks {
  const findingsById =
    new Map(
      visualFindings.map(
        (finding) => [
          finding.check_id,
          finding,
        ],
      ),
    );

  const aiArtifacts =
    findingsById.get(
      "ai_artifacts",
    );

  const poorFramingLighting =
    findingsById.get(
      "poor_framing_lighting",
    );

  const jarringTransitions =
    findingsById.get(
      "jarring_transitions",
    );

  if (
    !aiArtifacts ||
    !poorFramingLighting ||
    !jarringTransitions
  ) {
    throw new Error(
      "Visual audit did not return all required visual checks.",
    );
  }

  return {
    video_corruption:
      evaluateVideoCorruption(
        context,
      ),

    dropped_frames:
      evaluateDroppedFrames(
        context,
      ),

    ai_artifacts:
      findingToCheck(
        aiArtifacts,
        "AI Artifacts Audit",
      ),

    poor_framing_lighting:
      findingToCheck(
        poorFramingLighting,
        "Framing and Lighting Check",
      ),

    jarring_transitions:
      findingToCheck(
        jarringTransitions,
        "Transition Continuity Check",
      ),

    illegible_text:
      evaluateTextLegibility(
        context,
      ),
  };
}

function evaluateVideoCorruption(
  context: AgentContext,
): ProductionReadinessCheck {
  const corruptionDetected =
    context.video_metadata
      .corruption_detected;

  if (
    corruptionDetected ===
    undefined
  ) {
    return {
      check_id:
        "video_corruption",

      name:
        "Video corruption",

      result:
        "cannot_assess",

      severityScore:
        0,

      confidence_score:
        0,

      explanation:
        "Video corruption status cannot be determined because the metadata does not contain a corruption detection result.",
    };
  }

  if (
    corruptionDetected
  ) {
    return {
      check_id:
        "video_corruption",

      name:
        "Video corruption",

      result:
        "failed",

      severityScore:
        4,

      confidence_score:
        1,

      explanation:
        "Video corruption was detected in the video metadata.",
    };
  }

  return {
    check_id:
      "video_corruption",

    name:
      "Video corruption",

    result:
      "passed",

    severityScore:
      0,

    confidence_score:
      1,

    explanation:
      "No video corruption was detected.",
  };
}

function evaluateDroppedFrames(
  context: AgentContext,
): ProductionReadinessCheck {
  const count =
    context.video_metadata
      .dropped_frame_markers
      .length;

  if (count === 0) {
    return {
      check_id:
        "dropped_frames",

      name:
        "Dropped frames",

      result:
        "passed",

      severityScore:
        0,

      confidence_score:
        1,

      explanation:
        "No dropped frames were detected.",
    };
  }

  const severity:
    SeverityScore =
    count >= 10
      ? 3
      : count >= 5
      ? 2
      : 1;

  return {
    check_id:
      "dropped_frames",

    name:
      "Dropped frames",

    result:
      "failed",

    severityScore:
      severity,

    confidence_score:
      1,

    explanation:
      `${count} dropped frame marker(s) were detected.`,
  };
}

function findingToCheck(
  finding: VisualAuditFinding,
  name: string,
): ProductionReadinessCheck {
  const severity =
    finding.severity;

  const evidence:
    EvidenceRef | undefined =
    finding.evidence_text.trim()
      ? {
        type:
          "visual",

        text:
          finding.evidence_text,

        timestamp:
          timestampToString(
            finding.evidence_timestamp_ms,
          ),
      }
      : undefined;

  return {
    check_id:
      finding.check_id,

    name,

    result:
      severity === 0
        ? "passed"
        : "failed",

    severityScore:
      severity,

    confidence_score:
      finding.confidence_score,

    explanation:
      finding.explanation,

    evidence,
  };
}

function evaluateTextLegibility(
  context: AgentContext,
): ProductionReadinessCheck {
  if (
    context.ocr_segments.length ===
    0
  ) {
    return {
      check_id:
        "illegible_text",

      name:
        "Illegible text",

      result:
        "cannot_assess",

      severityScore:
        0,

      confidence_score:
        0,

      explanation:
        "Text legibility cannot be determined because no OCR segments are available.",
    };
  }

  const potentiallyIllegible =
    context.ocr_segments.some(
      (segment) => {
        if (
          segment.font_size_px !==
          undefined
        ) {
          return (
            segment.font_size_px <
            12
          );
        }

        if (
          segment.region_size !==
          undefined
        ) {
          return (
            segment.region_size <
            0.01
          );
        }

        return false;
      },
    );

  if (
    potentiallyIllegible
  ) {
    return {
      check_id:
        "illegible_text",

      name:
        "Illegible text",

      result:
        "failed",

      severityScore:
        2,

      confidence_score:
        0.7,

      explanation:
        "Some on-screen text may be too small or occupy too little screen area to be reliably legible.",
    };
  }

  return {
    check_id:
      "illegible_text",

    name:
      "Illegible text",

    result:
      "passed",

    severityScore:
      0,

    confidence_score:
      0.7,

    explanation:
      "No potentially illegible text was detected from the available OCR metadata.",
  };
}

function severityFromScore(
  score: number,
): MetricResult["severity"] {
  if (score >= 4) {
    return "critical";
  }

  if (score === 3) {
    return "high";
  }

  if (score === 2) {
    return "medium";
  }

  if (score === 1) {
    return "low";
  }

  return "none";
}

function timestampToString(
  timestampMs: number | null,
): string {
  if (
    timestampMs ===
    null
  ) {
    return "";
  }

  const totalSeconds =
    Math.floor(
      timestampMs / 1000,
    );

  const minutes =
    Math.floor(
      totalSeconds / 60,
    );

  const seconds =
    totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
}

function buildExplanation(
  result: MetricResult["result"],
  failedChecks: ProductionReadinessCheck[],
  cannotAssessChecks: ProductionReadinessCheck[],
): string {
  if (
    result === "true"
  ) {
    return "All production-readiness checks passed.";
  }

  if (
    result === "cannot_assess"
  ) {
    if (
      cannotAssessChecks.length ===
      1
    ) {
      return `Production readiness could not be fully assessed because "${cannotAssessChecks[0].name}" could not be assessed.`;
    }

    return `Production readiness could not be fully assessed because ${cannotAssessChecks.length} check(s) could not be assessed.`;
  }

  return `${failedChecks.length} production-readiness check(s) failed.`;
}