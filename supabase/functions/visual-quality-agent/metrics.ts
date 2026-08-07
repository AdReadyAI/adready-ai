import {
  cannotAssess,
  evidence,
  failed,
  passed,
  rollupChecks,
} from "../shared/checks.ts";

import type {
  AgentContext,
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";

import type { VisualAuditFinding } from "./visual-audit.ts";

/** A sub-check plus the metadata rollupChecks/schemas.ts don't carry. */
type CheckOutcome = {
  check: SubCheckResult;
  confidenceScore: number;
  evidenceRef?: EvidenceRef;
};

const VISUAL_FINDING_SEVERITY: Record<
  number,
  Exclude<SeverityLevel, "none" | "cannot_assess">
> = {
  1: "low",
  2: "medium",
  3: "high",
  4: "critical",
};

/**
 * Evaluates all six production-readiness checks
 * and synthesizes the final MetricResult.
 */
export function evaluateProductionReadiness(
  context: AgentContext,
  visualFindings: VisualAuditFinding[],
): MetricResult {
  const outcomes = evaluateProductionChecks(context, visualFindings);

  const subChecks = outcomes.map((o) => o.check);
  const failedChecks = subChecks.filter((c) => c.result === "failed");
  const cannotAssessChecks = subChecks.filter((c) =>
    c.result === "cannot_assess"
  );

  const rolledUp = rollupChecks(subChecks);
  const { result, severity } = rolledUp;

  const confidenceValues = outcomes
    .filter((o) => o.check.result !== "cannot_assess")
    .map((o) => o.confidenceScore);

  const averageConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length
    : 0;

  const confidence = averageConfidence >= 0.8
    ? "high"
    : averageConfidence >= 0.5
    ? "medium"
    : "low";

  const evidences = outcomes.flatMap((o) =>
    o.evidenceRef ? [o.evidenceRef] : []
  );

  return {
    metric_id: "production_readiness",
    agent: "visual_quality",
    metric_name: "Production / Asset Readiness",
    question:
      "Is the video technically complete enough to be reviewed or launched?",
    result,
    severity,
    confidence,
    evidence: evidences.length > 0 ? evidences : undefined,
    explanation: buildExplanation(result, failedChecks, cannotAssessChecks),
    suggested_correction: failedChecks.length > 0
      ? "Review and correct the failed production-readiness checks before launch."
      : undefined,
    correction_type: failedChecks.length > 0 ? "technical_fix" : undefined,
    sub_checks: subChecks,
  };
}

function evaluateProductionChecks(
  context: AgentContext,
  visualFindings: VisualAuditFinding[],
): CheckOutcome[] {
  const findingsById = new Map(visualFindings.map((f) => [f.check_id, f]));

  const aiArtifacts = findingsById.get("ai_artifacts");
  const poorFramingLighting = findingsById.get("poor_framing_lighting");
  const jarringTransitions = findingsById.get("jarring_transitions");

  if (!aiArtifacts || !poorFramingLighting || !jarringTransitions) {
    throw new Error("Visual audit did not return all required visual checks.");
  }

  return [
    evaluateVideoCorruption(context),
    evaluateDroppedFrames(context),
    findingToOutcome(aiArtifacts, "AI Artifacts Audit"),
    findingToOutcome(poorFramingLighting, "Framing and Lighting Check"),
    findingToOutcome(jarringTransitions, "Transition Continuity Check"),
    evaluateTextLegibility(context),
  ];
}

function evaluateVideoCorruption(context: AgentContext): CheckOutcome {
  const corruptionDetected = context.video_metadata.corruption_detected;

  if (corruptionDetected === undefined) {
    return {
      check: cannotAssess(
        "video_corruption",
        "Video corruption",
        "Video corruption status cannot be determined because the metadata does not contain a corruption detection result.",
      ),
      confidenceScore: 0,
    };
  }

  if (corruptionDetected) {
    return {
      check: failed(
        "video_corruption",
        "Video corruption",
        "critical",
        "Video corruption was detected in the video metadata.",
      ),
      confidenceScore: 1,
    };
  }

  return {
    check: passed("video_corruption", "Video corruption"),
    confidenceScore: 1,
  };
}

function evaluateDroppedFrames(context: AgentContext): CheckOutcome {
  const count = context.video_metadata.dropped_frame_markers.length;

  if (count === 0) {
    return {
      check: passed("dropped_frames", "Dropped frames"),
      confidenceScore: 1,
    };
  }

  const severity = count >= 10 ? "high" : count >= 5 ? "medium" : "low";

  return {
    check: failed(
      "dropped_frames",
      "Dropped frames",
      severity,
      `${count} dropped frame marker(s) were detected.`,
    ),
    confidenceScore: 1,
  };
}

function findingToOutcome(
  finding: VisualAuditFinding,
  name: string,
): CheckOutcome {
  const evidenceRef = finding.evidence_text.trim()
    ? evidence(
      "visual",
      finding.evidence_text,
      finding.evidence_timestamp_ms ?? undefined,
    )
    : undefined;

  const check = finding.severity === 0
    ? passed(finding.check_id, name)
    : failed(
      finding.check_id,
      name,
      VISUAL_FINDING_SEVERITY[finding.severity],
      finding.explanation,
    );

  return { check, confidenceScore: finding.confidence_score, evidenceRef };
}

function evaluateTextLegibility(context: AgentContext): CheckOutcome {
  const flaggedFrame = context.visual_frames.find((frame) =>
    // The media processor records visual unreadability independently of OCR's
    // geometric measurements, so either signal can fail launch readiness.
    frame.technical_flags.includes("illegible_text")
  );

  if (flaggedFrame) {
    return {
      check: failed(
        "illegible_text",
        "Illegible text",
        "medium",
        "Frame-level visual analysis detected blurry or unreadable on-screen text.",
      ),
      confidenceScore: 0.7,
      evidenceRef: evidence(
        "visual",
        flaggedFrame.action?.trim() ||
          "Frame-level analysis detected illegible on-screen text.",
        flaggedFrame.timestamp_ms,
      ),
    };
  }

  if (context.ocr_segments.length === 0) {
    return {
      check: cannotAssess(
        "illegible_text",
        "Illegible text",
        "Text legibility cannot be determined because no OCR segments are available.",
      ),
      confidenceScore: 0,
    };
  }

  const potentiallyIllegible = context.ocr_segments.some((segment) => {
    // Prefer the processor's direct font estimate and fall back to relative
    // screen area only when the direct measurement is unavailable.
    if (segment.font_size_px !== undefined) return segment.font_size_px < 12;
    if (segment.region_size !== undefined) return segment.region_size < 0.01;
    return false;
  });

  if (potentiallyIllegible) {
    return {
      check: failed(
        "illegible_text",
        "Illegible text",
        "medium",
        "Some on-screen text may be too small or occupy too little screen area to be reliably legible.",
      ),
      confidenceScore: 0.7,
    };
  }

  const hasUnmeasuredText = context.ocr_segments.some((segment) =>
    segment.font_size_px === undefined && segment.region_size === undefined
  );

  if (hasUnmeasuredText) {
    return {
      check: cannotAssess(
        "illegible_text",
        "Illegible text",
        "Text legibility cannot be fully determined because an OCR segment has no font-size or screen-area measurement.",
      ),
      confidenceScore: 0,
    };
  }

  return {
    check: passed("illegible_text", "Illegible text"),
    confidenceScore: 0.7,
  };
}

function buildExplanation(
  result: MetricResult["result"],
  failedChecks: SubCheckResult[],
  cannotAssessChecks: SubCheckResult[],
): string {
  if (result === "true") {
    if (cannotAssessChecks.length === 1) {
      return `All assessable production-readiness checks passed; "${
        cannotAssessChecks[0].name
      }" could not be assessed.`;
    }
    if (cannotAssessChecks.length > 1) {
      return `All assessable production-readiness checks passed; ${cannotAssessChecks.length} check(s) could not be assessed.`;
    }
    return "All production-readiness checks passed.";
  }

  if (result === "cannot_assess") {
    if (cannotAssessChecks.length === 1) {
      return `Production readiness could not be fully assessed because "${
        cannotAssessChecks[0].name
      }" could not be assessed.`;
    }
    return `Production readiness could not be fully assessed because ${cannotAssessChecks.length} check(s) could not be assessed.`;
  }

  return `${failedChecks.length} production-readiness check(s) failed.`;
}
