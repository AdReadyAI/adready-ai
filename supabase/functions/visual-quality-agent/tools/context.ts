/**
 * visual-quality-agent/tools/context.ts — Agent context provider.
 *
 * Provides the DB-shaped AgentContext required by the Visual Quality Agent.
 *
 * This implementation currently returns mock context because DB access
 * is not yet available.
 *
 * The function signature intentionally matches the future DB-backed
 * implementation so the mock can later be replaced with Supabase queries
 * without changing the rest of the agent pipeline.
 */

import { AgentContextSchema } from "../../shared/schemas.ts";

import type { AgentContext } from "../../shared/schemas.ts";

export async function getAgentContext(
  requestId: string,
): Promise<AgentContext> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const mockContext: AgentContext = {
    request_id: requestId,

    campaign_goal: "awareness",

    destination_platform: "tiktok",

    parsed_creative_brief: {
      raw_text:
        "Create a short-form social video introducing the product with a clear, premium visual style.",

      brand_voice: "Premium, modern, confident, approachable.",

      target_audience: "Young adults interested in premium lifestyle products.",

      required_messages: [
        "Show the product clearly.",
        "Communicate the product benefit.",
      ],

      required_ctas: [
        "Discover more",
      ],

      approved_claims: [],

      forbidden_claims: [],

      brand_guidelines: [
        "Maintain a clean premium visual style.",
        "Avoid excessive visual clutter.",
      ],

      policy_requirements: [],
    },

    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
      corruption_detected: false,
    },

    transcript_segments: [
      {
        segment_id: "transcript-1",
        start_ms: 1000,
        end_ms: 4500,
        text: "Discover a smarter way to experience your everyday routine.",
        speaker: "voiceover",
      },
      {
        segment_id: "transcript-2",
        start_ms: 11000,
        end_ms: 14000,
        text: "Discover more today.",
        speaker: "voiceover",
      },
    ],

    ocr_segments: [
      {
        ocr_id: "ocr-1",
        frame_ids: ["frame-1", "frame-2"],
        start_ms: 1000,
        end_ms: 4500,
        text: "A smarter everyday experience",
        on_screen_duration_ms: 3500,
        region_size: 0.18,
        font_size_px: 64,
      },
      {
        ocr_id: "ocr-2",
        frame_ids: ["frame-4"],
        start_ms: 11000,
        end_ms: 11500,
        text: "Discover more about our amazing product today",
        on_screen_duration_ms: 500,
        region_size: 0.003,
        font_size_px: 16,
      },
    ],

    visual_frames: [
      {
        frame_id: "frame-1",
        timestamp_ms: 1000,
        visual_description:
          "A clean product hero shot in a bright, premium environment. The product is centered and fully visible.",
        color_palette: {
          dominant_colors: ["white", "silver", "soft blue"],
          lighting_quality: "balanced and evenly exposed",
        },
        background: {
          location_type: "studio",
          mood: "premium and modern",
        },
        camera_movement: "static",
        technical_flags: [],
      },
      {
        frame_id: "frame-2",
        timestamp_ms: 4000,
        visual_description:
          "The product is shown in use by a person. The subject is clearly framed and the scene remains well lit.",
        color_palette: {
          dominant_colors: ["white", "blue", "neutral"],
          lighting_quality: "balanced",
        },
        background: {
          location_type: "modern interior",
          mood: "clean and aspirational",
        },
        camera_movement: "zoom",
        technical_flags: [],
      },
      {
        frame_id: "frame-3",
        timestamp_ms: 7000,
        visual_description:
          "A transition between scenes with the product moving across frame. The product shape visibly morphs between frames, the background flickers, and parts of the object appear duplicated or distorted.",
        color_palette: {
          dominant_colors: ["blue", "white"],
          lighting_quality: "consistent",
        },
        background: {
          location_type: "interior",
          mood: "dynamic",
        },
        camera_movement: "pan",
        technical_flags: [
          "AI morphing artifact",
          "flickering background",
          "object distortion",
          "ghosting",
        ],
      },
      {
        frame_id: "frame-4",
        timestamp_ms: 11000,
        visual_description:
          "Final product shot with a clear call to action displayed on screen.",
        color_palette: {
          dominant_colors: ["white", "silver"],
          lighting_quality: "balanced",
        },
        background: {
          location_type: "studio",
          mood: "premium",
        },
        camera_movement: "static",
        technical_flags: [],
      },
    ],

    product_frames: [],

    logo_frames: [],

    product_context: {
      raw_text:
        "Premium consumer product designed to simplify everyday routines.",

      claims: [
        "Designed to simplify everyday routines.",
      ],

      contraindications: [],

      reference_asset_urls: [],
    },
  };

  return AgentContextSchema.parse(mockContext);
}
