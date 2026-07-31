import { assertEquals } from "@std/assert";
import {
  AgentContextSchema,
  OCRSegmentSchema,
} from "../../../functions/shared/schemas.ts";

Deno.test("OCR segments normalize nullable database fields", () => {
  const segment = OCRSegmentSchema.parse({
    ocr_id: "ocr-1",
    frame_ids: ["frame-1"],
    start_ms: 0,
    end_ms: 250,
    text: "Launch today",
    on_screen_duration_ms: 250,
    region_size: null,
    font_size_px: null,
  });

  assertEquals(segment.region_size, undefined);
  assertEquals(segment.font_size_px, undefined);
});

Deno.test("agent context accepts nullable Postgres evidence columns", () => {
  const context = AgentContextSchema.parse({
    request_id: "00000000-0000-4000-8000-000000000001",
    campaign_goal: "Increase launch awareness",
    destination_platform: "instagram",
    parsed_creative_brief: {
      raw_text: "Introduce the product",
      brand_voice: null,
      target_audience: null,
      required_messages: [],
      required_ctas: [],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
    video_metadata: {
      duration_ms: 1000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
      corruption_detected: null,
    },
    transcript_segments: [],
    ocr_segments: [],
    visual_frames: [{
      frame_id: "frame-1",
      timestamp_ms: 0,
      image_url: null,
      visual_description: "The product appears on screen.",
      people: null,
      color_palette: null,
      background: null,
      camera_movement: null,
      technical_flags: [],
    }],
    product_frames: [{
      frame_id: "frame-1",
      timestamp_ms: 0,
      location: null,
      confidence_score: 0.9,
      prominence: null,
      focus_quality: null,
      framing: null,
      usage_context: null,
    }],
    logo_frames: [{
      frame_id: "frame-1",
      timestamp_ms: 0,
      location: null,
      confidence_score: 0.8,
      prominence: null,
      reference_match: null,
    }],
    product_context: {
      raw_text: null,
      claims: [],
      contraindications: [],
      reference_asset_urls: [],
    },
  });

  // Evaluators receive one consistent optional-value representation even
  // though Postgres serializes absent nullable columns as null.
  assertEquals(context.parsed_creative_brief.brand_voice, undefined);
  assertEquals(context.visual_frames[0].people, undefined);
  assertEquals(context.product_frames[0].location, undefined);
  assertEquals(context.logo_frames[0].reference_match, undefined);
  assertEquals(context.product_context?.raw_text, undefined);
});
