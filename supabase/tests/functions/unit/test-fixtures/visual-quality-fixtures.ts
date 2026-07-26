/**
 * visual-quality.fixture.ts — Shared Visual Quality Agent test fixtures.
 *
 * Provides deterministic AgentContext objects for unit tests.
 * These fixtures contain no external dependencies, database access,
 * environment variables, or LLM calls.
 */

import type { AgentContext } from "../../../../functions/shared/schemas.ts";

export const cleanVisualQualityContext: AgentContext = {
  request_id: "00000000-0000-0000-0000-000000000001",
  campaign_goal: "awareness",
  destination_platform: "tiktok",

  parsed_creative_brief: {
    raw_text: "Create a clean and professional product awareness video.",
    brand_voice: "Clear and professional",
    target_audience: "General consumers",
    required_messages: [],
    required_ctas: [],
    approved_claims: [],
    forbidden_claims: [],
    brand_guidelines: [],
    policy_requirements: [],
  },

  video_metadata: {
    duration_ms: 15000,
    aspect_ratio: "9:16",
    resolution: "1080x1920",
    dropped_frame_markers: [],
    corruption_detected: false,
  },

  transcript_segments: [],

  ocr_segments: [],

  visual_frames: [
    {
      frame_id: "frame-001",
      timestamp_ms: 0,
      visual_description:
        "A clearly framed product is shown in a well-lit environment.",
      color_palette: {
        dominant_colors: ["white", "blue"],
        lighting_quality: "balanced",
      },
      background: {
        location_type: "studio",
        mood: "clean",
      },
      camera_movement: "static",
      technical_flags: [],
    },
  ],

  product_frames: [],

  logo_frames: [],
};

export const failingVisualQualityContext: AgentContext = {
  ...cleanVisualQualityContext,

  visual_frames: [
    {
      frame_id: "frame-001",
      timestamp_ms: 7000,
      visual_description:
        "The subject's face and background visibly morph between frames.",
      color_palette: {
        dominant_colors: ["dark", "blue"],
        lighting_quality: "uneven",
      },
      background: {
        location_type: "studio",
        mood: "unstable",
      },
      camera_movement: "static",
      technical_flags: [
        "AI morphing artifacts",
        "visual distortion",
        "flickering background",
      ],
    },
  ],
};
