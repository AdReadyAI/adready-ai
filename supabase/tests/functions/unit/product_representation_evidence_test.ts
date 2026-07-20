import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildProductMomentContexts,
  buildUserContent,
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "../../../functions/product-representation-agent/evidence.ts";
import type { EvidenceBundle } from "../../../functions/shared/schemas.ts";

function makeBundleBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    variant_id: "variant-1",
    review_id: "review-1",
    transcript_segments: [
      { segment_id: "t1", start_ms: 0, end_ms: 1000, text: "Try Mango Moon" },
    ],
    ocr_segments: [],
    keyframes: [
      { frame_id: "f1", timestamp_ms: 500, scene_id: "s1", image_url: "https://cdn/f1.png" },
      { frame_id: "f2", timestamp_ms: 2500, scene_id: "s2", image_url: "https://cdn/f2.png" },
    ],
    scene_segments: [
      {
        scene_id: "s1",
        start_ms: 0,
        end_ms: 1000,
        visual_description: "A can of Mango Moon soda sits on a counter.",
      },
      {
        scene_id: "s2",
        start_ms: 2000,
        end_ms: 3000,
        visual_description: "Close-up of a hand holding the can.",
        visual_elements: { dominant_colors: ["#FFA500"], tone_mood: "bright" },
      },
    ],
    detected_claims: [],
    detected_ctas: [],
    product_moments: [
      { moment_id: "m1", start_ms: 500, end_ms: 2600, frame_ids: ["f1", "f2"] },
    ],
    reference_assets: [
      { asset_id: "ra1", type: "product_image", image_url: "https://cdn/ref.png" },
    ],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief: "Show the Mango Moon can clearly within the first 3 seconds.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    ...overrides,
  };
}

Deno.test("validateEvidenceBundle accepts a well-formed bundle", () => {
  const bundle = validateEvidenceBundle(makeBundleBody());
  assertEquals(bundle.review_id, "review-1");
});

Deno.test("validateEvidenceBundle rejects a missing video_metadata.duration_ms", () => {
  const bad = makeBundleBody({ video_metadata: { aspect_ratio: "9:16" } });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects a non-array product_moments", () => {
  const bad = makeBundleBody({ product_moments: "nope" });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("buildProductMomentContexts joins keyframes to their scene descriptions", () => {
  const bundle = validateEvidenceBundle(makeBundleBody()) as EvidenceBundle;
  const contexts = buildProductMomentContexts(bundle);

  assertEquals(contexts.length, 1);
  assertEquals(contexts[0].moment_id, "m1");
  assertEquals(
    contexts[0].scene_descriptions.some((d) =>
      d.includes("A can of Mango Moon soda sits on a counter.")
    ),
    true,
  );
  assertEquals(
    contexts[0].scene_descriptions.some((d) => d.includes("bright")),
    true,
  );
});

Deno.test("buildProductMomentContexts handles a moment with no matching keyframes", () => {
  const bundle = validateEvidenceBundle(
    makeBundleBody({
      product_moments: [
        { moment_id: "m2", start_ms: 5000, end_ms: 6000, frame_ids: ["missing"] },
      ],
    }),
  ) as EvidenceBundle;
  const contexts = buildProductMomentContexts(bundle);

  assertEquals(contexts[0].scene_descriptions, []);
});

Deno.test("buildUserContent includes the brief, moment descriptions, and duration", () => {
  const bundle = validateEvidenceBundle(makeBundleBody()) as EvidenceBundle;
  const content = buildUserContent(bundle);
  assertEquals(content.includes("Mango Moon can clearly"), true);
  assertEquals(content.includes("A can of Mango Moon soda sits on a counter."), true);
  assertEquals(content.includes("TOTAL VIDEO DURATION: 15000ms"), true);
});
