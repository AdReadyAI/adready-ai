import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildUserContent,
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "../../../functions/brief-alignment-agent/evidence.ts";
import type { EvidenceBundle } from "../../../functions/shared/schemas.ts";

function makeBundle(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    variant_id: "variant-1",
    review_id: "review-1",
    transcript_segments: [
      {
        segment_id: "t1",
        start_ms: 0,
        end_ms: 1000,
        text: "Try Mango Moon today",
      },
    ],
    ocr_segments: [],
    keyframes: [],
    scene_segments: [
      {
        scene_id: "s1",
        start_ms: 0,
        end_ms: 1000,
        visual_description: "A person opens a can of soda.",
      },
    ],
    detected_claims: [],
    detected_ctas: [],
    product_moments: [],
    reference_assets: [],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief:
      "Show the product in the first three seconds. Use the CTA Try Mango Moon.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    ...overrides,
  };
}

Deno.test("validateEvidenceBundle accepts a well-formed bundle", () => {
  const bundle = validateEvidenceBundle(makeBundle());
  assertEquals(bundle.review_id, "review-1");
});

Deno.test("validateEvidenceBundle rejects a non-object body", () => {
  assertThrows(() => validateEvidenceBundle("nope"), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects a missing creative_brief", () => {
  const bad = makeBundle({ creative_brief: undefined });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects an invalid campaign_goal", () => {
  const bad = makeBundle({ campaign_goal: "virality" });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects a non-array transcript_segments", () => {
  const bad = makeBundle({ transcript_segments: "nope" });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("buildUserContent includes the brief, goal, transcript, and scenes", () => {
  const bundle = validateEvidenceBundle(makeBundle()) as EvidenceBundle;
  const content = buildUserContent(bundle);
  assertEquals(content.includes("Try Mango Moon"), true);
  assertEquals(content.includes("CAMPAIGN GOAL: conversion"), true);
  assertEquals(content.includes("A person opens a can of soda."), true);
});
