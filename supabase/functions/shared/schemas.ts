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
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  speaker: z.string().optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const OCRSegmentSchema = z.object({
  segment_id: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  confidence: z.number(), // 0.0 - 1.0
  on_screen_duration_ms: z.number(),
  contrast_ratio: z.number().optional(),
  region_size: z.number().optional(),
  font_size_px: z.number().optional(),
});
export type OCRSegment = z.infer<typeof OCRSegmentSchema>;

export const SceneSegmentSchema = z.object({
  scene_id: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  visual_description: z.string(), // 1-3 sentences describing visual action
  // Richer description object for demographic, palette, and mood checks
  visual_elements: z.object({
    detected_people: z.array(z.string()).optional(),   // e.g. ["adult female (25-30)"]
    clothing_style: z.string().optional(),      // e.g. "casual athletic wear"
    dominant_colors: z.array(z.string()).optional(),   // e.g. ["#FF5733", "#C70039"]
    tone_mood: z.string().optional(),           // e.g. "energetic, bright"
  }).optional(),
});
export type SceneSegment = z.infer<typeof SceneSegmentSchema>;

export const DetectedClaimSchema = z.object({
  claim_id: z.string(),
  text: z.string(),
  source: z.enum(["transcript", "ocr"]),
  start_ms: z.number(),
  end_ms: z.number(),
});
export type DetectedClaim = z.infer<typeof DetectedClaimSchema>;

export const DetectedCTASchema = z.object({
  cta_id: z.string(),
  text: z.string(),
  source: z.enum(["transcript", "ocr", "visual"]),
  start_ms: z.number(),
  end_ms: z.number(),
});
export type DetectedCTA = z.infer<typeof DetectedCTASchema>;

export const ProductMomentSchema = z.object({
  moment_id: z.string(),
  start_ms: z.number(),
  end_ms: z.number(),
  frame_ids: z.array(z.string()),
});
export type ProductMoment = z.infer<typeof ProductMomentSchema>;

export const ReferenceAssetSchema = z.object({
  asset_id: z.string(),
  type: z.enum(["product_image", "logo", "brand_style_guide"]),
  image_url: z.string(),
});
export type ReferenceAsset = z.infer<typeof ReferenceAssetSchema>;

export const VideoMetadataSchema = z.object({
  duration_ms: z.number(),
  aspect_ratio: z.string(),
  resolution: z.string(),
  corruption_flag: z.boolean(),
  dropped_frame_markers: z.array(z.number()),
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
  detected_claims: z.array(DetectedClaimSchema),
  detected_ctas: z.array(DetectedCTASchema),
  product_moments: z.array(ProductMomentSchema),
  reference_assets: z.array(ReferenceAssetSchema),
  video_metadata: VideoMetadataSchema,

  // Product Platform Context
  creative_brief: z.string(),
  campaign_goal: z.enum(["awareness", "consideration", "conversion", "repurchase"]),
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
  type: z.enum(["transcript", "ocr", "visual", "brief", "product_page", "metadata"]),
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
  correction_type: z.enum(["rewrite", "edit_recommendation", "technical_fix", "none"]).optional(),
  sub_checks: z.array(SubCheckResultSchema).optional(), // Granular sub-checks evaluated by the agent
});
export type MetricResult = z.infer<typeof MetricResultSchema>;
