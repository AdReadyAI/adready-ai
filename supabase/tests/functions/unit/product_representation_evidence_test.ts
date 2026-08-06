import { assertEquals } from "@std/assert";
import { buildUserContent } from "../../../functions/product-representation-agent/evidence.ts";
import {
  type AgentContext,
  AgentContextSchema,
} from "../../../functions/shared/schemas.ts";

function makeContext(overrides: Record<string, unknown> = {}): AgentContext {
  return AgentContextSchema.parse({
    request_id: "11111111-1111-1111-1111-111111111111",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text: "Show the Mango Moon can clearly within the first 3 seconds.",
    },
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
    },
    transcript_segments: [
      { segment_id: "t1", start_ms: 0, end_ms: 1000, text: "Try Mango Moon" },
    ],
    ocr_segments: [],
    visual_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        visual_description: "A can of Mango Moon soda sits on a counter.",
      },
      {
        frame_id: "f2",
        timestamp_ms: 2500,
        visual_description: "Close-up of a hand holding the can.",
      },
    ],
    product_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        confidence_score: 0.95,
        prominence: "foreground_static",
        focus_quality: "sharp",
      },
      {
        frame_id: "f2",
        timestamp_ms: 2500,
        confidence_score: 0.8,
        prominence: "foreground_in_use",
      },
    ],
    logo_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        confidence_score: 0.7,
        prominence: "small_corner",
        reference_match: "matches_reference",
      },
    ],
    product_context: {
      raw_text: "Mango Moon is a tropical sparkling soda.",
      claims: ["8g plant protein"],
      reference_asset_urls: ["https://cdn/ref.png"],
    },
    ...overrides,
  });
}

Deno.test("buildUserContent joins product frames to their visual-frame descriptions", () => {
  const content = buildUserContent(makeContext());
  assertEquals(
    content.includes("A can of Mango Moon soda sits on a counter."),
    true,
  );
  assertEquals(content.includes("prominence: foreground_static"), true);
});

Deno.test("buildUserContent includes the brief, product context, and duration", () => {
  const content = buildUserContent(makeContext());
  assertEquals(content.includes("Mango Moon can clearly"), true);
  assertEquals(
    content.includes("Mango Moon is a tropical sparkling soda."),
    true,
  );
  assertEquals(content.includes("TOTAL VIDEO DURATION: 15000ms"), true);
});

Deno.test("buildUserContent renders placeholders when frame sections are empty", () => {
  const content = buildUserContent(
    makeContext({ product_frames: [], logo_frames: [] }),
  );
  assertEquals(content.includes("(no product frames detected)"), true);
  assertEquals(content.includes("(no logo frames detected)"), true);
});
