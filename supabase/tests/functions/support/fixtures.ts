/**
 * fixtures.ts — AgentContext factory for tests.
 *
 * Agents consume the DB-loaded AgentContext (loaded by request_id in production).
 * `makeAgentContext(overrides)` returns a schema-valid nominal context; pass a
 * partial to override any top-level field. Kept minimal but valid against
 * AgentContextSchema so tests fail on contract drift, not on fixture rot.
 */

import type { AgentContext } from "../../../functions/shared/schemas.ts";

export function makeAgentContext(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  const base: AgentContext = {
    request_id: "11111111-1111-1111-1111-111111111111",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text:
        "Required CTA: Try Mango Moon. Communicate fun tropical snack energy.",
      required_messages: ["fun tropical snack energy"],
      required_ctas: ["Try Mango Moon"],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
    video_metadata: {
      duration_ms: 10000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
      corruption_detected: false,
    },
    transcript_segments: [
      { segment_id: "t1", start_ms: 0, end_ms: 3000, text: "Meet Mango Moon." },
      {
        segment_id: "t2",
        start_ms: 3000,
        end_ms: 9000,
        text: "A tropical energy drink.",
      },
    ],
    ocr_segments: [
      {
        ocr_id: "o1",
        frame_ids: ["f3"],
        start_ms: 8000,
        end_ms: 10000,
        text: "Try Mango Moon",
        on_screen_duration_ms: 2000,
        region_size: 1800,
        font_size_px: 42,
      },
    ],
    visual_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 0,
        visual_description: "Product hero shot on a beach.",
      },
      {
        frame_id: "f2",
        timestamp_ms: 4000,
        visual_description: "Person drinking, smiling.",
      },
      {
        frame_id: "f3",
        timestamp_ms: 9000,
        visual_description: "End card with the CTA.",
      },
    ],
    product_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 0,
        confidence_score: 0.9,
        prominence: "foreground_in_use",
      },
    ],
    logo_frames: [
      {
        frame_id: "f3",
        timestamp_ms: 9000,
        confidence_score: 0.8,
        prominence: "small_corner",
      },
    ],
    product_context: {
      raw_text: "Mango Moon tropical energy drink.",
      claims: [],
      contraindications: [],
      reference_asset_urls: [],
    },
  };
  return { ...base, ...overrides };
}
