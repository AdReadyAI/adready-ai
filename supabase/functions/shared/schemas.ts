/**
 * schemas.ts — Shared Zod schemas and inferred TypeScript types for the AdReady Eval Scorecard.
 *
 * Single source of truth for agent invocation/context types and the output
 * MetricResult array.
 */

import { z } from "zod";

// 1. INPUT: Agent invocation + DB-loaded context

export const AgentNameSchema = z.enum([
  "claims-agent",
  "storyline-clarity-agent",
  "cta-effectiveness-agent",
  "product-representation-agent",
  "visual-quality-agent",
  "brand-alignment-agent",
  "brief-alignment-agent",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

/**
 * Minimal request envelope used by orchestration to tell an agent which DB
 * context to load. Evidence records are not passed directly in the request.
 */
export const AgentRunRequestSchema = z.object({
  request_id: z.string().uuid(),
  agent: AgentNameSchema.optional(),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const ParsedCreativeBriefSchema = z.object({
  raw_text: z.string(),
  brand_voice: z.string().optional(),
  target_audience: z.string().optional(),
  required_messages: z.array(z.string()).default([]),
  required_ctas: z.array(z.string()).default([]),
  approved_claims: z.array(z.string()).default([]),
  forbidden_claims: z.array(z.string()).default([]),
  brand_guidelines: z.array(z.string()).default([]),
  policy_requirements: z.array(z.string()).default([]),
});
export type ParsedCreativeBrief = z.infer<typeof ParsedCreativeBriefSchema>;

export const TranscriptSegmentSchema = z.object({
  segment_id: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  speaker: z.string().optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const OCRSegmentSchema = z.object({
  ocr_id: z.string(),
  frame_ids: z.array(z.string()),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  text: z.string(),
  on_screen_duration_ms: z.number().int().nonnegative(),
  region_size: z.number().optional(),
  font_size_px: z.number().int().nonnegative().optional(),
});
export type OCRSegment = z.infer<typeof OCRSegmentSchema>;

export const VisualFrameSchema = z.object({
  frame_id: z.string(),
  timestamp_ms: z.number().int().nonnegative(),
  image_url: z.string().url().optional(),
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
  background: z.object({
    location_type: z.string(),
    mood: z.string(),
  }).optional(),
  camera_movement: z.enum(["static", "pan", "zoom", "handheld"]).optional(),
  technical_flags: z.array(z.string()).optional(),
});
export type VisualFrame = z.infer<typeof VisualFrameSchema>;

export const ProductFrameSchema = z.object({
  frame_id: z.string(),
  timestamp_ms: z.number().int().nonnegative(),
  // Coordinates are not formally specified yet, so preserve the processor's value.
  location: z.unknown().optional(),
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
export type ProductFrame = z.infer<typeof ProductFrameSchema>;

export const LogoFrameSchema = z.object({
  frame_id: z.string(),
  timestamp_ms: z.number().int().nonnegative(),
  location: z.unknown().optional(),
  confidence_score: z.number(),
  prominence: z.enum([
    "large_central",
    "small_corner",
    "background_signage",
    "absent",
  ]).optional(),
  reference_match: z.enum([
    "matches_reference",
    "differs_from_reference",
    "cannot_determine",
  ]).optional(),
});
export type LogoFrame = z.infer<typeof LogoFrameSchema>;

export const VideoMetadataSchema = z.object({
  duration_ms: z.number().int().nonnegative(),
  aspect_ratio: z.string(),
  resolution: z.string(),
  dropped_frame_markers: z.array(z.number().int().nonnegative()),
  corruption_detected: z.boolean().optional(),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

export const ProductContextSchema = z.object({
  raw_text: z.string().optional(),
  claims: z.array(z.string()).default([]),
  contraindications: z.array(z.string()).default([]),
  reference_asset_urls: z.array(z.string().url()).default([]),
});
export type ProductContext = z.infer<typeof ProductContextSchema>;

/**
 * Context shape loaded by agents from DB rows using request_id.
 */
export const AgentContextSchema = z.object({
  request_id: z.string().uuid(),
  campaign_goal: z.string().min(1),
  destination_platform: z.string().min(1),
  parsed_creative_brief: ParsedCreativeBriefSchema,
  video_metadata: VideoMetadataSchema,
  transcript_segments: z.array(TranscriptSegmentSchema),
  ocr_segments: z.array(OCRSegmentSchema),
  visual_frames: z.array(VisualFrameSchema),
  product_frames: z.array(ProductFrameSchema),
  logo_frames: z.array(LogoFrameSchema),
  product_context: ProductContextSchema.optional(),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

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
