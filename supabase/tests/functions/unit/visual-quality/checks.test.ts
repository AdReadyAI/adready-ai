/**
 * checks.test.ts — Unit tests for the individual sub-checks evaluated by
 * `evaluateProductionReadiness` (metrics.ts): video_corruption, dropped_frames,
 * the LLM-derived visual findings (ai_artifacts / poor_framing_lighting /
 * jarring_transitions), and illegible_text.
 *
 * deno test --config supabase/deno.json supabase/tests/functions/unit/visual-quality/checks.test.ts
 */

import { assertEquals, assertExists, assertThrows } from "@std/assert";

import { evaluateProductionReadiness } from "../../../../functions/visual-quality-agent/metrics.ts";

import {
  BASE_VIDEO_METADATA,
  buildContext,
  buildFinding,
  buildOcrSegment,
  buildPassingFindings,
  findSubCheck,
} from "./fixtures.ts";

// ---------------------------------------------------------------------------
// video_corruption
// ---------------------------------------------------------------------------

Deno.test("video_corruption: detected=true fails with critical severity", () => {
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: true },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(result.result, "false");
  assertEquals(result.severity, "critical");
  assertEquals(findSubCheck(result, "video_corruption")?.result, "failed");
  assertEquals(findSubCheck(result, "video_corruption")?.severity, "critical");
});

Deno.test("video_corruption: detected=false passes", () => {
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, corruption_detected: false },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "video_corruption")?.result, "passed");
  assertEquals(findSubCheck(result, "video_corruption")?.severity, "none");
});

Deno.test("video_corruption: undefined yields cannot_assess for that sub-check", () => {
  const context = buildContext({
    video_metadata: {
      ...BASE_VIDEO_METADATA,
      corruption_detected: undefined,
    },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(
    findSubCheck(result, "video_corruption")?.result,
    "cannot_assess",
  );
  // No failures anywhere else, so overall result should be cannot_assess.
  assertEquals(result.result, "cannot_assess");
  assertEquals(result.severity, "cannot_assess");
});

// ---------------------------------------------------------------------------
// dropped_frames severity thresholds
// ---------------------------------------------------------------------------

Deno.test("dropped_frames: zero markers passes", () => {
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, dropped_frame_markers: [] },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());
  assertEquals(findSubCheck(result, "dropped_frames")?.result, "passed");
});

Deno.test("dropped_frames: 1-4 markers -> low severity", () => {
  const context = buildContext({
    video_metadata: {
      ...BASE_VIDEO_METADATA,
      dropped_frame_markers: [100, 200],
    },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());
  assertEquals(findSubCheck(result, "dropped_frames")?.result, "failed");
  assertEquals(findSubCheck(result, "dropped_frames")?.severity, "low");
  assertEquals(result.severity, "low");
});

Deno.test("dropped_frames: 5-9 markers -> medium severity", () => {
  const context = buildContext({
    video_metadata: {
      ...BASE_VIDEO_METADATA,
      dropped_frame_markers: [1, 2, 3, 4, 5],
    },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());
  assertEquals(findSubCheck(result, "dropped_frames")?.severity, "medium");
});

Deno.test("dropped_frames: exactly 10 markers -> high severity (boundary)", () => {
  const markers = Array.from({ length: 10 }, (_, i) => i * 100);
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, dropped_frame_markers: markers },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());
  assertEquals(findSubCheck(result, "dropped_frames")?.severity, "high");
});

Deno.test("dropped_frames: exactly 9 markers stays medium (boundary below 10)", () => {
  const markers = Array.from({ length: 9 }, (_, i) => i * 100);
  const context = buildContext({
    video_metadata: { ...BASE_VIDEO_METADATA, dropped_frame_markers: markers },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());
  assertEquals(findSubCheck(result, "dropped_frames")?.severity, "medium");
});

Deno.test("dropped_frames: explanation mentions the marker count", () => {
  const context = buildContext({
    video_metadata: {
      ...BASE_VIDEO_METADATA,
      dropped_frame_markers: [1, 2, 3],
    },
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());
  assertEquals(
    findSubCheck(result, "dropped_frames")?.explanation,
    "3 dropped frame marker(s) were detected.",
  );
});

// ---------------------------------------------------------------------------
// LLM-derived visual findings (ai_artifacts / poor_framing_lighting / jarring_transitions)
// ---------------------------------------------------------------------------

Deno.test("visual findings: severity 0 passes, nonzero fails and maps through severityFromScore", () => {
  const context = buildContext();
  const findings = buildPassingFindings({
    ai_artifacts: { severity: 3 },
  });
  const result = evaluateProductionReadiness(context, findings);

  assertEquals(findSubCheck(result, "ai_artifacts")?.result, "failed");
  assertEquals(findSubCheck(result, "ai_artifacts")?.severity, "high");
  assertEquals(result.result, "false");
  assertEquals(result.severity, "high");
});

Deno.test("visual findings: attaches evidence only when evidence_text is non-empty", () => {
  const context = buildContext();
  const findings = buildPassingFindings({
    ai_artifacts: {
      severity: 2,
      evidence_text: "warped hand visible",
      evidence_timestamp_ms: 65_000,
    },
  });
  const result = evaluateProductionReadiness(context, findings);

  assertExists(result.evidence);
  assertEquals(result.evidence?.length, 1);
  assertEquals(result.evidence?.[0].type, "visual");
  assertEquals(result.evidence?.[0].text, "warped hand visible");
  assertEquals(result.evidence?.[0].timestamp, "01:05");
});

Deno.test("visual findings: whitespace-only evidence_text is treated as no evidence", () => {
  const context = buildContext();
  const findings = buildPassingFindings({
    ai_artifacts: {
      severity: 1,
      evidence_text: "   ",
      evidence_timestamp_ms: 1000,
    },
  });
  const result = evaluateProductionReadiness(context, findings);

  assertEquals(result.evidence, undefined);
});

Deno.test("visual findings: null evidence_timestamp_ms formats to empty string", () => {
  const context = buildContext();
  const findings = buildPassingFindings({
    jarring_transitions: {
      severity: 1,
      evidence_text: "hard cut mid-sentence",
      evidence_timestamp_ms: null,
    },
  });
  const result = evaluateProductionReadiness(context, findings);

  assertEquals(result.evidence?.[0].timestamp, "");
});

Deno.test("visual findings: multiple findings with evidence all appear in evidence array", () => {
  const context = buildContext();
  const findings = buildPassingFindings({
    ai_artifacts: {
      severity: 1,
      evidence_text: "artifact a",
      evidence_timestamp_ms: 0,
    },
    poor_framing_lighting: {
      severity: 1,
      evidence_text: "framing issue",
      evidence_timestamp_ms: 3_000,
    },
  });
  const result = evaluateProductionReadiness(context, findings);

  assertEquals(result.evidence?.length, 2);
});

Deno.test("evaluateProductionReadiness: throws if a required visual finding is missing", () => {
  const context = buildContext();
  const incompleteFindings = [
    buildFinding("ai_artifacts"),
    buildFinding("poor_framing_lighting"),
    // jarring_transitions missing
  ];

  assertThrows(
    () => evaluateProductionReadiness(context, incompleteFindings),
    Error,
    "Visual audit did not return all required visual checks.",
  );
});

// ---------------------------------------------------------------------------
// illegible_text
// ---------------------------------------------------------------------------

Deno.test("illegible_text: no OCR segments -> cannot_assess", () => {
  const context = buildContext({ ocr_segments: [] });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "cannot_assess");
});

Deno.test("illegible_text: font_size_px below 12 fails", () => {
  const context = buildContext({
    ocr_segments: [buildOcrSegment({ font_size_px: 8 })],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "failed");
  assertEquals(findSubCheck(result, "illegible_text")?.severity, "medium");
});

Deno.test("illegible_text: font_size_px at exactly 12 passes (boundary)", () => {
  const context = buildContext({
    ocr_segments: [buildOcrSegment({ font_size_px: 12 })],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "passed");
});

Deno.test("illegible_text: region_size below 0.01 fails when font_size_px absent", () => {
  const context = buildContext({
    ocr_segments: [buildOcrSegment({ region_size: 0.005 })],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "failed");
});

Deno.test("illegible_text: font_size_px takes precedence over region_size when both present", () => {
  // font_size_px is fine (>=12) but region_size would fail on its own.
  // Current implementation only falls through to region_size when font_size_px is undefined,
  // so this segment should pass.
  const context = buildContext({
    ocr_segments: [
      buildOcrSegment({ font_size_px: 20, region_size: 0.001 }),
    ],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "passed");
});

Deno.test("illegible_text: segment with neither font_size_px nor region_size is treated as legible", () => {
  // Documents current behavior: a segment with no measurable size data does not
  // trigger a failure and is not distinguished from a genuinely legible segment.
  const context = buildContext({
    ocr_segments: [
      buildOcrSegment({ font_size_px: undefined, region_size: undefined }),
    ],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "passed");
});

Deno.test("illegible_text: any single failing segment among many fails the whole check", () => {
  const context = buildContext({
    ocr_segments: [
      buildOcrSegment({ ocr_id: "ocr-1", font_size_px: 20 }),
      buildOcrSegment({ ocr_id: "ocr-2", font_size_px: 6 }),
      buildOcrSegment({ ocr_id: "ocr-3", font_size_px: 18 }),
    ],
  });
  const result = evaluateProductionReadiness(context, buildPassingFindings());

  assertEquals(findSubCheck(result, "illegible_text")?.result, "failed");
});
