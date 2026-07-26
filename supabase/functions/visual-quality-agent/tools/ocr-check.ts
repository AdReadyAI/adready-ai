/**
 * visual-quality-agent/tools/ocr-check.ts — OCR-based text quality checks.
 *
 * Evaluates whether on-screen text has metadata characteristics that may
 * make it difficult to read.
 *
 * Uses available OCR metadata such as:
 * - font size,
 * - on-screen duration,
 * - text region size,
 * - and text length.
 *
 * This is a conservative heuristic check. It identifies likely legibility
 * problems but does not claim to replace direct visual inspection of the
 * rendered text.
 */

import type { AgentContext, OCRSegment } from "../../shared/schemas.ts";

import type { InternalCheckResult } from "../types.ts";

import { evidenceFromTimestamp } from "../utils.ts";

export function checkOCR(
  context: AgentContext,
): Pick<
  Record<"illegible_text", InternalCheckResult>,
  "illegible_text"
> {
  const segments = context.ocr_segments;

  if (segments.length === 0) {
    return {
      illegible_text: {
        check_id: "illegible_text",
        name: "Text Quality Check",
        result: "cannot_assess",
        severityScore: 0,
        explanation:
          "No OCR segments were available, so on-screen text legibility could not be assessed.",
        confidence_score: 0,
      },
    };
  }

  const candidates = segments.filter(
    isPotentiallyIllegible,
  );

  if (candidates.length === 0) {
    return {
      illegible_text: {
        check_id: "illegible_text",
        name: "Text Quality Check",
        result: "passed",
        severityScore: 0,
        explanation:
          "Available OCR timing and sizing metadata did not identify likely text-legibility problems.",
        confidence_score: 0.75,
      },
    };
  }

  const mostSevere = candidates
    .sort(
      (a, b) =>
        legibilityRiskScore(b) -
        legibilityRiskScore(a),
    )[0];

  const severityScore = legibilityRiskScore(mostSevere);

  return {
    illegible_text: {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "failed",
      severityScore,
      explanation:
        "One or more on-screen text elements have metadata characteristics associated with potential legibility issues.",
      evidence: evidenceFromTimestamp(
        "ocr",
        `Potentially illegible on-screen text: "${mostSevere.text}".`,
        mostSevere.start_ms,
      ),
      confidence_score: 0.65,
    },
  };
}

function isPotentiallyIllegible(
  segment: OCRSegment,
): boolean {
  if (
    segment.font_size_px !== undefined &&
    segment.font_size_px < 24
  ) {
    return true;
  }

  if (
    segment.on_screen_duration_ms < 1000 &&
    segment.text.length > 20
  ) {
    return true;
  }

  if (
    segment.region_size !== undefined &&
    segment.region_size < 0.01 &&
    segment.text.length > 10
  ) {
    return true;
  }

  return false;
}

function legibilityRiskScore(
  segment: OCRSegment,
): 1 | 2 {
  let risk = 0;

  if (
    segment.font_size_px !== undefined &&
    segment.font_size_px < 18
  ) {
    risk += 2;
  } else if (
    segment.font_size_px !== undefined &&
    segment.font_size_px < 24
  ) {
    risk += 1;
  }

  if (
    segment.on_screen_duration_ms < 750
  ) {
    risk += 1;
  }

  if (
    segment.region_size !== undefined &&
    segment.region_size < 0.005
  ) {
    risk += 1;
  }

  return risk >= 2 ? 2 : 1;
}
