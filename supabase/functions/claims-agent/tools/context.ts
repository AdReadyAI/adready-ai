/**
 * tools/context.ts — Loads all DB-backed context needed to run the agent,
 * keyed by request_id.
 *
 * Currently returns fixture data shaped exactly like a real AgentContext --
 * there's no Supabase query wired up yet. When that's built, this function
 * body is what changes (query parsed_creative_brief, transcript_segments,
 * ocr_segments, product_context, etc. from Supabase); the AgentContextProvider
 * signature and everything downstream stays the same.
 *
 * Includes a puffery line ("Glow like never before.") and a repeated claim
 * (said in the voiceover, then echoed as on-screen text later) so the
 * pipeline has something concrete to filter and dedupe.
 */

// import type { AgentContext } from "../../shared/schemas.ts";
import type { AgentContextProvider } from "../types.ts";

export const getAgentContext: AgentContextProvider = async (request_id) => {
  await new Promise((resolve) => setTimeout(resolve, 100)); // simulate network latency

  return {
    request_id,
    campaign_goal: "Drive purchases of NovaGlow anti-aging serum",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text:
        "Promote NovaGlow serum. Focus on hydration and glow benefits. Do not reference clinical trials — none were run.",
      brand_voice: "confident, friendly, approachable",
      target_audience: "women 25-45 interested in skincare",
      required_messages: [
        "Dermatologist-recommended ingredients",
        "Visible glow in as little as 1 week",
      ],
      required_ctas: ["Shop Now"],
      approved_claims: [
        "In a 1-week consumer survey, 87% reported smoother-looking skin",
        "Formulated with dermatologist-recommended ingredients",
      ],
      forbidden_claims: [
        "clinically proven",
        "cures",
        "eliminates wrinkles",
        "fda approved",
      ],
      brand_guidelines: [
        "Use brand teal (#0F9E9E) in overlays",
        "Logo must appear in first 3 seconds",
      ],
      policy_requirements: [
        "Results-may-vary disclaimer required for before/after claims",
      ],
    },
    video_metadata: {
      duration_ms: 30000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
      corruption_detected: false,
    },
    transcript_segments: [
      {
        segment_id: "t1",
        start_ms: 8000,
        end_ms: 11500,
        text:
          "This serum is clinically proven to reduce wrinkles in just 7 days.",
        speaker: "narrator",
      },
      {
        segment_id: "t2",
        start_ms: 15000,
        end_ms: 18000,
        text:
          "Formulated with dermatologist-recommended ingredients for a natural glow.",
        speaker: "narrator",
      },
      {
        segment_id: "t3",
        start_ms: 25000,
        end_ms: 27000,
        text: "Glow like never before.",
        speaker: "narrator",
      },
    ],
    ocr_segments: [
      {
        ocr_id: "o1",
        frame_ids: ["f1", "f2"],
        start_ms: 2000,
        end_ms: 4500,
        text: "Disclaimer: Results may vary.",
        on_screen_duration_ms: 2500,
        region_size: 0.04,
        font_size_px: 10,
      },
      {
        // Echoes the t1 voiceover claim as on-screen text later in the ad --
        // this should be merged into the SAME claim as t1, not treated as a
        // second, separate claim.
        ocr_id: "o2",
        frame_ids: ["f6"],
        start_ms: 20000,
        end_ms: 22000,
        text: "Clinically proven to reduce wrinkles",
        on_screen_duration_ms: 2000,
        region_size: 0.05,
        font_size_px: 14,
      },
    ],
    visual_frames: [],
    product_frames: [],
    logo_frames: [],
    product_context: {
      raw_text: "NovaGlow Hydra-Glow Serum product page.",
      claims: [
        "In a 1-week consumer survey, 87% reported smoother-looking skin",
        "Formulated with dermatologist-recommended ingredients",
      ],
      contraindications: ["Not tested on pregnant or nursing individuals"],
      reference_asset_urls: [],
    },
  };
};
