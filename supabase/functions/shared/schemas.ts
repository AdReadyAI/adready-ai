/**
 * schemas.ts — Shared Zod schemas and inferred TypeScript types for the AdReady Eval Scorecard.
 *
 * Single source of truth for the 10 core metrics, input EvidenceBundle,
 * and the output MetricResult array.
 */

import { z } from "npm:zod@^3.22.4";

// 1. INPUT: EvidenceBundle (Provided as-is by Media Processing)

export const TranscriptSegmentSchema = z.object({
  segment_id: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  speaker: z.string().optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const OCRSegmentSchema = z.object({
  // The input specification calls this `frame_id` and describes it as a list of frames.
  frame_id: z.array(z.string()),
  ocr_id: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  on_screen_duration_ms: z.number().int().nonnegative(),
  region_size: z.number().optional(),
  font_size_px: z.number().int().nonnegative().optional(),
});
export type OCRSegment = z.infer<typeof OCRSegmentSchema>;

export const SceneSegmentSchema = z.object({
  frame_id: z.string(),
  timestamp: z.number().int().nonnegative(),
  visual_description: z.string(), // 1-3 sentences describing visual action
  people: z.object({
    count: z.number().int().nonnegative(),
    apparent_ages: z.array(z.string()),
    apparent_presentation: z.array(z.string()),
    activity: z.string(),
    clothing_style: z.string(),
  }).optional(),
  color_palette: z.object({
    dominant_colors: z.array(z.string()),
    lighting_quality: z.string(),
  }).optional(),
  scenery: z.object({
    location_type: z.string(),
    mood: z.string(),
  }).optional(),
  camera_movement: z.enum(["static", "pan", "zoom", "handheld"]).optional(),
  technical_flags: z.array(z.string()).optional(),
});
export type SceneSegment = z.infer<typeof SceneSegmentSchema>;

export const ProductMomentSchema = z.object({
  frame_id: z.string(),
  // Coordinates are not formally specified yet, so preserve the media processor's value.
  location: z.unknown(),
  confidence_score: z.number(),
  prominence: z.enum([
    "foreground_in_use",
    "foreground_static",
    "background",
    "not_visible",
  ]).optional(),
  focus_quality: z.enum(["sharp", "soft_focus", "blurry"]).optional(),
  framing: z.enum(["fully_visible", "partially_cropped", "heavily_obscured"])
    .optional(),
  usage_context: z.string().optional(),
});
export type ProductMoment = z.infer<typeof ProductMomentSchema>;

export const VideoMetadataSchema = z.object({
  duration_ms: z.number().int().nonnegative(),
  aspect_ratio: z.string(),
  resolution: z.string(),
  dropped_frame_markers: z.array(z.number().int().nonnegative()),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

/**
 * Top-level Input envelope received by each agent
 */
export const EvidenceBundleSchema = z.object({
  variant_id: z.string().uuid(),
  review_id: z.string().uuid(),

  // Media Processing Inputs
  transcript_segments: z.array(TranscriptSegmentSchema),
  ocr_segments: z.array(OCRSegmentSchema),
  scene_segments: z.array(SceneSegmentSchema),
  product_moments: z.array(ProductMomentSchema),
  video_metadata: VideoMetadataSchema,

  // Product Platform Context
  creative_brief: z.string(),
  campaign_goal: z.string().min(1),
  destination_platform: z.string(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

// 2. OUTPUT: MetricResult & 10 Scorecard Metrics
export const MetricIdSchema = z.enum([
  "brief_adherence",
  "product_clarity",
  "product_truth",
  "audience_fit",
  "brand_fit",
  "cta_clarity",
  "channel_readiness",
  "production_readiness",
  "policy_compliance",
  "creative_effectiveness",
]);
export type MetricId = z.infer<typeof MetricIdSchema>;

export const SeverityLevelSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "critical",
  "cannot_assess",
]);
export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;

export const ConfidenceLevelSchema = z.enum(["low", "medium", "high"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const EvidenceRefSchema = z.object({
  type: z.enum([
    "transcript",
    "ocr",
    "visual",
    "brief",
    "product_page",
    "metadata",
  ]),
  text: z.string(),
  timestamp: z.string(), // MM:SS format or empty string
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const SubCheckResultSchema = z.object({
  check_id: z.string(),
  name: z.string(),
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: SeverityLevelSchema,
  explanation: z.string().optional(),
});
export type SubCheckResult = z.infer<typeof SubCheckResultSchema>;

export const MetricResultSchema = z.object({
  metric_id: MetricIdSchema,
  agent: z.enum([
    "claims_accuracy",
    "storyline_clarity",
    "brand_alignment",
    "brief_alignment",
    "product_representation",
    "visual_quality",
    "cta_effectiveness",
  ]),
  metric_name: z.string(),
  question: z.string(),
  result: z.enum(["true", "false", "cannot_assess"]),
  severity: SeverityLevelSchema,
  confidence: ConfidenceLevelSchema.optional(),
  evidence: z.array(EvidenceRefSchema).optional(),
  explanation: z.string().optional(),
  suggested_correction: z.string().optional(),
  correction_type: z.enum([
    "rewrite",
    "edit_recommendation",
    "technical_fix",
    "none",
  ]).optional(),
  sub_checks: z.array(SubCheckResultSchema).optional(), // Granular sub-checks evaluated by the agent
});
export type MetricResult = z.infer<typeof MetricResultSchema>;
