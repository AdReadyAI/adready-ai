/**
 * Unit tests for CTA deterministic sub-checks (checks.ts).
 *
 * Checks operate on the acquired CTA list (numeric start_ms/end_ms) and on
 * ocr_segments. Config is injected, covering the populated severity boundaries
 * and the cannot_assess fallback when config is null. No LLM, no network.
 */

import { assertEquals } from "@std/assert";
import {
  ctaBuried,
  ctaLowVisibility,
  ctaMistimed,
  ctaPlatformMismatch,
} from "../../../functions/cta-effectiveness-agent/checks.ts";
import type {
  CtaTiming,
  CtaVisibilityThresholds,
} from "../../../functions/cta-effectiveness-agent/config.ts";
import type { OCRSegment } from "../../../functions/shared/schemas.ts";
import type { AcquiredCta } from "../../../functions/cta-effectiveness-agent/response_schemas.ts";

const TIMING: CtaTiming = {
  buried_window_ms: 5000,
  landing_zone_start_fraction: 0.7,
  landing_zone_end_fraction: 1.0,
  min_dwell_ms: 1000,
};

function cta(overrides: Partial<AcquiredCta> = {}): AcquiredCta {
  return {
    text: "Shop now",
    source: "on_screen",
    start_ms: 8000,
    end_ms: 9500,
    explicit: true,
    ...overrides,
  };
}

// --- cta_buried --------------------------------------------------------------

Deno.test("cta_buried: cannot_assess when timing config is null", () => {
  assertEquals(ctaBuried([cta()], null).result, "cannot_assess");
});

Deno.test("cta_buried: no CTA → passed (absence is cta_absent's job)", () => {
  assertEquals(ctaBuried([], TIMING).result, "passed");
});

Deno.test("cta_buried: failed/high when every occurrence is in the opening window", () => {
  const r = ctaBuried([cta({ start_ms: 1000, end_ms: 2500 })], TIMING);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "high");
});

Deno.test("cta_buried: passed when a later occurrence exists", () => {
  const r = ctaBuried(
    [cta({ start_ms: 1000 }), cta({ start_ms: 8000 })],
    TIMING,
  );
  assertEquals(r.result, "passed");
});

// --- cta_mistimed ------------------------------------------------------------

Deno.test("cta_mistimed: cannot_assess when timing null", () => {
  assertEquals(ctaMistimed([cta()], 10000, null).result, "cannot_assess");
});

Deno.test("cta_mistimed: cannot_assess when duration unknown", () => {
  assertEquals(ctaMistimed([cta()], 0, TIMING).result, "cannot_assess");
});

Deno.test("cta_mistimed: no CTA → passed", () => {
  assertEquals(ctaMistimed([], 10000, TIMING).result, "passed");
});

Deno.test("cta_mistimed: passed when an occurrence lands in-zone and dwells enough", () => {
  const r = ctaMistimed([cta({ start_ms: 8000, end_ms: 9500 })], 10000, TIMING);
  assertEquals(r.result, "passed");
});

Deno.test("cta_mistimed: low when in-zone but dwell too brief", () => {
  const r = ctaMistimed([cta({ start_ms: 8000, end_ms: 8300 })], 10000, TIMING);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "low");
});

Deno.test("cta_mistimed: medium when no occurrence lands in the closing zone", () => {
  const r = ctaMistimed([cta({ start_ms: 1000, end_ms: 3000 })], 10000, TIMING);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "medium");
});

// --- cta_low_visibility (size-only) ------------------------------------------

const VIS: CtaVisibilityThresholds = {
  min_region_size: 1000,
  marginal_region_size: 2000,
  min_font_size_px: 20,
  marginal_font_size_px: 32,
};

function ocr(overrides: Partial<OCRSegment> = {}): OCRSegment {
  return {
    ocr_id: "o1",
    frame_ids: ["f3"],
    start_ms: 8000,
    end_ms: 9500,
    text: "Shop now",
    on_screen_duration_ms: 1500,
    region_size: 2500,
    font_size_px: 42,
    ...overrides,
  };
}

Deno.test("cta_low_visibility: cannot_assess when thresholds null", () => {
  assertEquals(
    ctaLowVisibility([cta()], [ocr()], null).result,
    "cannot_assess",
  );
});

Deno.test("cta_low_visibility: passed when the only CTA is audio (no on-screen surface)", () => {
  assertEquals(
    ctaLowVisibility([cta({ source: "audio" })], [], VIS).result,
    "passed",
  );
});

Deno.test("cta_low_visibility: cannot_assess when on-screen CTA has no size numbers", () => {
  const r = ctaLowVisibility([cta()], [
    ocr({ region_size: undefined, font_size_px: undefined }),
  ], VIS);
  assertEquals(r.result, "cannot_assess");
});

Deno.test("cta_low_visibility: none when region and font size are clear", () => {
  assertEquals(ctaLowVisibility([cta()], [ocr()], VIS).result, "passed");
});

Deno.test("cta_low_visibility: low when marginal", () => {
  const r = ctaLowVisibility([cta()], [
    ocr({ region_size: 1500, font_size_px: 28 }),
  ], VIS);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "low");
});

Deno.test("cta_low_visibility: medium when under-size (region or font too small)", () => {
  const r = ctaLowVisibility([cta()], [ocr({ font_size_px: 16 })], VIS);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "medium");
});

Deno.test("cta_low_visibility: a co-timed non-CTA overlay (disclaimer) does not drag the score", () => {
  // The CTA renders large, but a tiny legal disclaimer shares its time window.
  // Temporal overlap alone would pick the disclaimer (worst-wins) and falsely
  // report medium; text association scopes the check to the CTA's own rendering.
  const legibleCta = ocr({
    ocr_id: "cta",
    text: "Shop now",
    region_size: 2500,
    font_size_px: 42,
  });
  const disclaimer = ocr({
    ocr_id: "fine_print",
    text: "Auto-renews monthly. Cancel anytime. Terms apply.",
    region_size: 1500,
    font_size_px: 16,
  });
  const r = ctaLowVisibility([cta()], [legibleCta, disclaimer], VIS);
  assertEquals(r.result, "passed");
});

Deno.test("cta_low_visibility: still flags when the CTA's own rendering is too small", () => {
  // Same disclaimer, but now the CTA text itself is under-size — a real failure
  // that text association must not mask.
  const smallCta = ocr({
    ocr_id: "cta",
    text: "Shop now",
    region_size: 2500,
    font_size_px: 16,
  });
  const disclaimer = ocr({
    ocr_id: "fine_print",
    text: "Auto-renews monthly. Cancel anytime. Terms apply.",
    region_size: 1500,
    font_size_px: 14,
  });
  const r = ctaLowVisibility([cta()], [smallCta, disclaimer], VIS);
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "medium");
});

// --- cta_platform_mismatch ---------------------------------------------------

Deno.test("cta_platform_mismatch: cannot_assess when the convention table is null", () => {
  assertEquals(ctaPlatformMismatch(["Swipe up"], null).result, "cannot_assess");
});

Deno.test("cta_platform_mismatch: passed when no CTA text", () => {
  assertEquals(
    ctaPlatformMismatch([], { discouraged_phrases: ["swipe up"] }).result,
    "passed",
  );
});

Deno.test("cta_platform_mismatch: medium when a discouraged phrase is used", () => {
  const r = ctaPlatformMismatch(["Swipe up to shop"], {
    discouraged_phrases: ["swipe up"],
  });
  assertEquals(r.result, "failed");
  assertEquals(r.severity, "medium");
});

Deno.test("cta_platform_mismatch: passed when phrasing is clean", () => {
  assertEquals(
    ctaPlatformMismatch(["Tap the link"], { discouraged_phrases: ["swipe up"] })
      .result,
    "passed",
  );
});
