/**
 * Unit tests for Storyline deterministic sub-checks (checks.ts).
 *
 * Only format_noncompliant is deterministic now (pacing is LLM-judged). Config is
 * injected, covering the populated severity boundaries and the cannot_assess
 * fallback when the spec table is null. No LLM, no network.
 */

import { assertEquals } from "@std/assert";
import {
  formatNoncompliant,
  isSparseAnalysis,
} from "../../../functions/storyline-clarity-agent/checks.ts";
import type { PlatformSpec } from "../../../functions/storyline-clarity-agent/config.ts";
import type { ArcLabeling } from "../../../functions/storyline-clarity-agent/response_schemas.ts";
import type { VideoMetadata } from "../../../functions/shared/schemas.ts";
import { makeAgentContext } from "../support/fixtures.ts";

function arc(overall_confidence: "low" | "medium" | "high"): ArcLabeling {
  return { arc: [], unfilled_roles: [], payoff_resolved_at: null, overall_confidence };
}

const SPEC: PlatformSpec = {
  allowed_aspect_ratios: ["9:16"],
  min_width: 1080,
  min_height: 1920,
  optimal_max_duration_ms: 30000,
  max_duration_ms: 60000,
};

function meta(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    duration_ms: 10000,
    aspect_ratio: "9:16",
    resolution: "1080x1920",
    dropped_frame_markers: [],
    corruption_detected: false,
    ...overrides,
  };
}

Deno.test("format_noncompliant: cannot_assess when the spec table is null", () => {
  const r = formatNoncompliant(meta(), null);
  assertEquals(r.result, "cannot_assess");
  assertEquals(r.severity, "cannot_assess");
});

Deno.test("format_noncompliant: none when everything matches", () => {
  const r = formatNoncompliant(meta(), SPEC);
  assertEquals(r.result, "passed");
  assertEquals(r.severity, "none");
});

Deno.test("format_noncompliant: none when corruption flag is absent (optional field)", () => {
  const r = formatNoncompliant(meta({ corruption_detected: undefined }), SPEC);
  assertEquals(r.result, "passed");
});

Deno.test("format_noncompliant: critical on corruption", () => {
  const r = formatNoncompliant(meta({ corruption_detected: true }), SPEC);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "critical");
});

Deno.test("format_noncompliant: high on wrong aspect ratio", () => {
  const r = formatNoncompliant(meta({ aspect_ratio: "16:9" }), SPEC);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "high");
});

Deno.test("format_noncompliant: high on under-min resolution", () => {
  const r = formatNoncompliant(meta({ resolution: "720x1280" }), SPEC);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "high");
});

Deno.test("format_noncompliant: low on minor over-optimal duration", () => {
  const r = formatNoncompliant(meta({ duration_ms: 31000 }), SPEC);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "low");
});

Deno.test("format_noncompliant: medium over the hard duration limit", () => {
  const r = formatNoncompliant(meta({ duration_ms: 61000 }), SPEC);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "medium");
});

// --- isSparseAnalysis (input-density gate) ------------------------------------

Deno.test("isSparseAnalysis: true when the arc could not be labeled (null)", () => {
  assertEquals(isSparseAnalysis(makeAgentContext(), null), true);
});

Deno.test("isSparseAnalysis: true when arc overall_confidence is low", () => {
  assertEquals(isSparseAnalysis(makeAgentContext(), arc("low")), true);
});

Deno.test("isSparseAnalysis: true when frames are too few for the runtime", () => {
  // 1 frame over 15s needs ceil(15000/5000)=3 → sparse, even at high arc confidence.
  const ctx = makeAgentContext({
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
      corruption_detected: false,
    },
    visual_frames: [
      { frame_id: "f1", timestamp_ms: 0, visual_description: "one frame" },
    ],
  });
  assertEquals(isSparseAnalysis(ctx, arc("high")), true);
});

Deno.test("isSparseAnalysis: false when frames are dense and the arc is confident", () => {
  // base fixture: 3 frames over 10s (needs 2), arc high → not sparse.
  assertEquals(isSparseAnalysis(makeAgentContext(), arc("high")), false);
});
