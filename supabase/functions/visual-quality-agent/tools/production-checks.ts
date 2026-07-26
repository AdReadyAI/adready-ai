/**
 * visual-quality-agent/tools/production-checks.ts — Deterministic production checks.
 *
 * Combines metadata, OCR, and visual-audit findings into the six internal
 * production-readiness checks consumed by metrics.ts.
 *
 * This module does not produce the final MetricResult.
 * It only determines the outcome of each individual check.
 */

import type { AgentContext, EvidenceRef } from "../../shared/schemas.ts";

import type {
  ProductionReadinessCheck,
  ProductionReadinessChecks,
  VisualAuditFinding,
} from "../types.ts";

import { msToTimestamp } from "../utils.ts";

function metadataEvidence(
  text: string,
): EvidenceRef {
  return {
    type: "metadata",
    text,
    timestamp: "",
  };
}

function visualEvidence(
  finding: VisualAuditFinding,
): EvidenceRef {
  return {
    type: "visual",
    text: finding.evidence_text,
    timestamp: finding.evidence_timestamp_ms === null
      ? ""
      : msToTimestamp(finding.evidence_timestamp_ms),
  };
}

function evaluateVideoCorruption(
  context: AgentContext,
): ProductionReadinessCheck {
  if (context.video_metadata.corruption_detected === undefined) {
    return {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
      explanation:
        "Video corruption status is not available in the loaded metadata.",
    };
  }

  if (context.video_metadata.corruption_detected) {
    return {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "failed",
      severityScore: 4,
      confidence_score: 1,
      explanation:
        "The video asset is marked as corrupted or otherwise invalid.",
      evidence: metadataEvidence(
        "Video metadata indicates that the video asset is corrupted.",
      ),
    };
  }

  return {
    check_id: "video_corruption",
    name: "File Integrity",
    result: "passed",
    severityScore: 0,
    confidence_score: 1,
  };
}

function evaluateDroppedFrames(
  context: AgentContext,
): ProductionReadinessCheck {
  const markers = context.video_metadata.dropped_frame_markers;

  if (markers.length === 0) {
    return {
      check_id: "dropped_frames",
      name: "Frame Sync Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    };
  }

  const evidenceTimestamp = markers[0];

  return {
    check_id: "dropped_frames",
    name: "Frame Sync Check",
    result: "failed",
    severityScore: 3,
    confidence_score: 1,
    explanation: `Dropped-frame or stutter markers were detected at ${
      msToTimestamp(evidenceTimestamp)
    }.`,
    evidence: {
      type: "metadata",
      text: `Dropped-frame marker detected at ${
        msToTimestamp(evidenceTimestamp)
      }.`,
      timestamp: msToTimestamp(evidenceTimestamp),
    },
  };
}

function evaluateVisualCheck(
  finding: VisualAuditFinding | undefined,
  checkId:
    | "ai_artifacts"
    | "poor_framing_lighting"
    | "jarring_transitions",
  name: string,
): ProductionReadinessCheck {
  if (!finding) {
    return {
      check_id: checkId,
      name,
      result: "passed",
      severityScore: 0,
      confidence_score: 0.8,
    };
  }

  return {
    check_id: checkId,
    name,
    result: "failed",
    severityScore: finding.severity,
    confidence_score: finding.confidence_score,
    explanation: finding.explanation,
    evidence: visualEvidence(finding),
  };
}

function evaluateIllegibleText(
  context: AgentContext,
): ProductionReadinessCheck {
  const ocrSegments = context.ocr_segments;

  if (ocrSegments.length === 0) {
    return {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 0.8,
    };
  }

  const missingLegibilityData = ocrSegments.some(
    (segment) =>
      segment.font_size_px === undefined &&
      segment.region_size === undefined,
  );

  if (missingLegibilityData) {
    return {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
      explanation:
        "OCR text was detected, but insufficient size or region information is available to reliably assess text legibility.",
    };
  }

  const potentiallyIllegible = ocrSegments.find(
    (segment) =>
      (segment.font_size_px !== undefined &&
        segment.font_size_px < 24) ||
      (segment.region_size !== undefined &&
        segment.region_size < 0.01),
  );

  if (potentiallyIllegible) {
    return {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "failed",
      severityScore: 2,
      confidence_score: 0.75,
      explanation:
        "On-screen text may be too small or occupy too little screen area to remain reliably readable.",
      evidence: {
        type: "ocr",
        text: potentiallyIllegible.text,
        timestamp: msToTimestamp(
          potentiallyIllegible.start_ms,
        ),
      },
    };
  }

  return {
    check_id: "illegible_text",
    name: "Text Quality Check",
    result: "passed",
    severityScore: 0,
    confidence_score: 0.8,
  };
}

export function evaluateProductionChecks(
  context: AgentContext,
  visualFindings: VisualAuditFinding[],
): ProductionReadinessChecks {
  const aiArtifacts = visualFindings.find(
    (finding) => finding.check_id === "ai_artifacts",
  );

  const framingLighting = visualFindings.find(
    (finding) => finding.check_id === "poor_framing_lighting",
  );

  const transitions = visualFindings.find(
    (finding) => finding.check_id === "jarring_transitions",
  );

  return {
    video_corruption: evaluateVideoCorruption(context),

    dropped_frames: evaluateDroppedFrames(context),

    ai_artifacts: evaluateVisualCheck(
      aiArtifacts,
      "ai_artifacts",
      "AI Artifacts Audit",
    ),

    poor_framing_lighting: evaluateVisualCheck(
      framingLighting,
      "poor_framing_lighting",
      "Framing and Lighting Check",
    ),

    jarring_transitions: evaluateVisualCheck(
      transitions,
      "jarring_transitions",
      "Transition Continuity Check",
    ),

    illegible_text: evaluateIllegibleText(context),
  };
}
