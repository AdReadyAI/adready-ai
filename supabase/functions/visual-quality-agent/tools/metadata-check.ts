/**
 * visual-quality-agent/tools/metadata-check.ts — Video metadata checks.
 *
 * Performs deterministic production-quality checks using video metadata.
 *
 * Evaluates:
 * - video_corruption: whether the video file is reported as corrupted.
 * - dropped_frames: whether dropped-frame markers indicate playback issues.
 *
 * These checks do not require an LLM because the underlying signals are
 * already provided by the media-processing pipeline.
 */

import type { AgentContext } from "../../shared/schemas.ts";

import type { InternalCheckResult } from "../types.ts";

import { evidenceFromTimestamp } from "../utils.ts";

export function checkMetadata(
  context: AgentContext,
): Pick<
  Record<
    "video_corruption" | "dropped_frames",
    InternalCheckResult
  >,
  "video_corruption" | "dropped_frames"
> {
  return {
    video_corruption: checkVideoCorruption(context),

    dropped_frames: checkDroppedFrames(context),
  };
}

function checkVideoCorruption(
  context: AgentContext,
): InternalCheckResult {
  const corrupted = context.video_metadata.corruption_detected === true;

  if (!corrupted) {
    return {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "passed",
      severityScore: 0,
      explanation:
        "No video file corruption was reported by the available metadata.",
      confidence_score: 0.98,
    };
  }

  return {
    check_id: "video_corruption",
    name: "File Integrity",
    result: "failed",
    severityScore: 4,
    explanation:
      "The video metadata indicates that the media asset is corrupted or cannot be considered technically reliable.",
    evidence: evidenceFromTimestamp(
      "metadata",
      "Video corruption was reported by the media metadata gate.",
      null,
    ),
    confidence_score: 1,
  };
}

function checkDroppedFrames(
  context: AgentContext,
): InternalCheckResult {
  const markers = context.video_metadata.dropped_frame_markers;

  if (markers.length === 0) {
    return {
      check_id: "dropped_frames",
      name: "Frame Sync Check",
      result: "passed",
      severityScore: 0,
      explanation:
        "No dropped-frame markers were reported in the available video metadata.",
      confidence_score: 0.95,
    };
  }

  const duration = context.video_metadata.duration_ms;

  const markerRatio = duration > 0
    ? markers.length / Math.max(1, duration / 1000)
    : 1;

  let severityScore: 1 | 2 | 3;

  if (markerRatio >= 1) {
    severityScore = 3;
  } else if (markerRatio >= 0.25) {
    severityScore = 2;
  } else {
    severityScore = 1;
  }

  const timestamp = markers.length > 0 ? markers[0] : null;

  return {
    check_id: "dropped_frames",
    name: "Frame Sync Check",
    result: "failed",
    severityScore,
    explanation: `${markers.length} dropped-frame marker${
      markers.length === 1 ? "" : "s"
    } were detected in the video metadata.`,
    evidence: evidenceFromTimestamp(
      "metadata",
      `Dropped-frame marker detected at ${
        timestamp === null ? "an unspecified time" : `${timestamp}ms`
      }.`,
      timestamp,
    ),
    confidence_score: 0.98,
  };
}
