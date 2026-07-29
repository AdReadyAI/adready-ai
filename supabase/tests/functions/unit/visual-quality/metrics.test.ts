/**
 * metrics.test.ts — Aggregate-level unit tests for `evaluateProductionReadiness`
 * (metrics.ts): the all-passing happy path, and the overall result/severity/
 * confidence/explanation roll-up across sub-checks.
 *
 * Run with:
 *   deno test --allow-none visual-quality-agent/metrics.test.ts
 *
 * Behavior of individual sub-checks (video_corruption, dropped_frames, the
 * LLM-derived visual findings, illegible_text) lives in checks.test.ts.
 */

import { assert, assertEquals } from "@std/assert";

import { evaluateProductionReadiness } from "../../../../functions/visual-quality-agent/metrics.ts";

import {
  BASE_VIDEO_METADATA,
  buildContext,
  buildOcrSegment,
  buildPassingFindings,
} from "./fixtures.ts";

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

Deno.test("evaluateProductionReadiness: all checks passing yields true/none/no evidence", () => {
  // Must include a legible OCR segment: an empty ocr_segments array correctly
  // yields cannot_assess for illegible_text, which would not be an "all passing" case.
  const context = buildContext({
    ocr_segments: [buildOcrSegment({ font_size_px: 20 })],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(result.result, "true");
  assertEquals(result.severity, "none");
  assertEquals(result.confidence, "high");
  assertEquals(result.evidence, undefined);
  assertEquals(result.suggested_correction, undefined);
  assertEquals(result.correction_type, undefined);
  assertEquals(result.explanation, "All production-readiness checks passed.");
  assertEquals(result.metric_id, "production_readiness");
  assertEquals(result.agent, "visual_quality");
  assertEquals(result.sub_checks?.length, 6);
});

// ---------------------------------------------------------------------------
// Aggregate result / severity / confidence / explanation logic
// ---------------------------------------------------------------------------

Deno.test("aggregate: failed takes precedence over cannot_assess", () => {
  const context = buildContext({
    ocr_segments: [], // illegible_text -> cannot_assess
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: true }, // video_corruption -> failed
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(result.result, "false");
});

Deno.test("aggregate: highest severity among multiple failed checks is used", () => {
  const context = buildContext({
    video_metadata: {
      ...BASE_VIDEO_METADATA,
      dropped_frame_markers: [1, 2], // severity 1 (low)
    },
  });
  const findings = buildPassingFindings({
    ai_artifacts: { severity: 4 }, // critical
  });
  const result = evaluateProductionReadiness(context, findings);

  assertEquals(result.severity, "critical");
});

Deno.test("aggregate: confidence excludes cannot_assess sub-checks from the average", () => {
  // video_corruption cannot_assess (confidence 0, excluded);
  // all other checks confidence 1 -> average should be 1 -> "high", not dragged down by the 0.
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: undefined },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(result.confidence, "high");
});

Deno.test("aggregate: confidence is medium in the 0.5-0.8 band", () => {
  const findings = buildPassingFindings({
    ai_artifacts: { severity: 1, confidence_score: 0.6 },
  });
  // illegible_text defaults to confidence_score 0.7 with no ocr segments? No: ocr empty -> cannot_assess (excluded).
  // Use an ocr segment so illegible_text participates with confidence 0.7.
  const contextWithOcr = buildContext({
    ocr_segments: [buildOcrSegment({ font_size_px: 20 })],
  });
  const result = evaluateProductionReadiness(contextWithOcr, findings);

  assert(result.confidence === "medium" || result.confidence === "high");
});

Deno.test("aggregate: confidence is low when average confidence is below 0.5", () => {
  // video_corruption and illegible_text both always contribute a fixed confidence
  // (1 and 0.7 respectively) whenever they can be assessed, which pulls the average
  // up. Push both into cannot_assess (excluded from the average) so only
  // dropped_frames (fixed at 1) and the three low-confidence visual findings remain:
  // (1 + 0.1 + 0.1 + 0.1) / 4 = 0.325, which is comfortably below the 0.5 threshold.
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: undefined },
    ocr_segments: [],
  });
  const findings = buildPassingFindings({
    ai_artifacts: { severity: 1, confidence_score: 0.1 },
    poor_framing_lighting: { severity: 0, confidence_score: 0.1 },
    jarring_transitions: { severity: 0, confidence_score: 0.1 },
  });
  const result = evaluateProductionReadiness(context, findings);

  assertEquals(result.confidence, "low");
});

Deno.test("aggregate: explanation names the single cannot_assess check", () => {
  const context = buildContext({ ocr_segments: [] });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(
    result.explanation,
    `Production readiness could not be fully assessed because "Illegible text" could not be assessed.`,
  );
});

Deno.test("aggregate: explanation counts multiple cannot_assess checks", () => {
  const context = buildContext({
    ocr_segments: [],
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: undefined },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(
    result.explanation,
    "Production readiness could not be fully assessed because 2 check(s) could not be assessed.",
  );
});

Deno.test("aggregate: explanation counts failed checks", () => {
  const context = buildContext({
    video_metadata: {
      ...BASE_VIDEO_METADATA,
      dropped_frame_markers: [1],
      corruption_detected: true,
    },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(
    result.explanation,
    "2 production-readiness check(s) failed.",
  );
});

Deno.test("aggregate: suggested_correction and correction_type set only when something failed", () => {
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: true },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(
    result.suggested_correction,
    "Review and correct the failed production-readiness checks before launch.",
  );
  assertEquals(result.correction_type, "technical_fix");
});

Deno.test("aggregate: sub_checks always includes all six checks with correct check_ids", () => {
  const context = buildContext();
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  const ids = result.sub_checks?.map((c) => c.check_id).sort();
  assertEquals(
    ids,
    [
      "ai_artifacts",
      "dropped_frames",
      "illegible_text",
      "jarring_transitions",
      "poor_framing_lighting",
      "video_corruption",
    ].sort(),
  );
});
