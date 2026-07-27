/**
 * Unit tests for Storyline deterministic sub-checks (checks.ts).
 *
 * Only format_noncompliant is deterministic now (pacing is LLM-judged). Config is
 * injected, covering the populated severity boundaries and the cannot_assess
 * fallback when the spec table is null. No LLM, no network.
 */

import { assertEquals } from "@std/assert";
import { formatNoncompliant } from "../../../functions/storyline-clarity-agent/checks.ts";
import type { PlatformSpec } from "../../../functions/_evaluator/config.ts";
import type { VideoMetadata } from "../../../functions/shared/schemas.ts";

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
