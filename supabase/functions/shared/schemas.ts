/**
 * schemas.ts — Shared TypeScript types for the AdReady Eval Scorecard.
 *
 * Single source of truth for the 10 core metrics, input EvidenceBundle,
 * and the output MetricResult array.
 */

// ---------------------------------------------------------------------------
// 1. INPUT: EvidenceBundle (Provided as-is by Media Processing)
// ---------------------------------------------------------------------------

export type TranscriptSegment = {
  segment_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker?: string;
};

export type OCRSegment = {
  segment_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number; // 0.0 - 1.0
  on_screen_duration_ms: number;
  contrast_ratio?: number;
  region_size?: number;
  font_size_px?: number;
};

export type Keyframe = {
  frame_id: string;
  timestamp_ms: number;
  scene_id: string;
  image_url: string; // Supabase Storage CDN URL
};

export type SceneSegment = {
  scene_id: string;
  start_ms: number;
  end_ms: number;
  visual_description: string; // 1-3 sentences describing visual action
  // Richer description object for demographic, palette, and mood checks
  visual_elements?: {
    detected_people?: string[];   // e.g. ["adult female (25-30)"]
    clothing_style?: string;      // e.g. "casual athletic wear"
    dominant_colors?: string[];   // e.g. ["#FF5733", "#C70039"]
    tone_mood?: string;           // e.g. "energetic, bright"
  };
};

export type DetectedClaim = {
  claim_id: string;
  text: string;
  source: "transcript" | "ocr";
  start_ms: number;
  end_ms: number;
};

export type DetectedCTA = {
  cta_id: string;
  text: string;
  source: "transcript" | "ocr" | "visual";
  start_ms: number;
  end_ms: number;
};

export type ProductMoment = {
  moment_id: string;
  start_ms: number;
  end_ms: number;
  frame_ids: string[];
};

export type ReferenceAsset = {
  asset_id: string;
  type: "product_image" | "logo" | "brand_style_guide";
  image_url: string;
};

export type VideoMetadata = {
  duration_ms: number;
  aspect_ratio: string;
  resolution: string;
  corruption_flag: boolean;
  dropped_frame_markers: number[];
};

/**
 * Top-level Input envelope received by each agent
 */
export type EvidenceBundle = {
  variant_id: string;
  review_id: string;

  // Media Processing Inputs
  transcript_segments: TranscriptSegment[];
  ocr_segments: OCRSegment[];
  keyframes: Keyframe[];
  scene_segments: SceneSegment[];
  detected_claims: DetectedClaim[];
  detected_ctas: DetectedCTA[];
  product_moments: ProductMoment[];
  reference_assets: ReferenceAsset[];
  video_metadata: VideoMetadata;

  // Product Platform Context
  creative_brief: string;
  campaign_goal: "awareness" | "consideration" | "conversion" | "repurchase";
  destination_platform: string;
};

// ---------------------------------------------------------------------------
// 2. OUTPUT: MetricResult & 10 Scorecard Metrics
// ---------------------------------------------------------------------------

export type MetricId =
  | "brief_adherence"
  | "product_clarity"
  | "product_truth"
  | "audience_fit"
  | "brand_fit"
  | "cta_clarity"
  | "channel_readiness"
  | "production_readiness"
  | "policy_compliance"
  | "creative_effectiveness";

export type SeverityLevel =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "cannot_assess";

export type ConfidenceLevel = "low" | "medium" | "high";

export type EvidenceRef = {
  type: "transcript" | "ocr" | "visual" | "brief" | "product_page" | "metadata";
  text: string;
  timestamp: string; // MM:SS format or empty string
};

export type SubCheckResult = {
  check_id: string;
  name: string;
  result: "passed" | "failed" | "cannot_assess";
  severity: SeverityLevel;
  explanation?: string;
};

export type MetricResult = {
  metric_id: MetricId;
  agent:
    | "claims_accuracy"
    | "storyline_clarity"
    | "brand_alignment"
    | "brief_alignment"
    | "product_representation"
    | "visual_quality"
    | "cta_effectiveness";
  metric_name: string;
  question: string;
  result: "true" | "false" | "cannot_assess";
  severity: SeverityLevel;
  confidence?: ConfidenceLevel;
  evidence?: EvidenceRef[];
  explanation?: string;
  suggested_correction?: string;
  correction_type?: "rewrite" | "edit_recommendation" | "technical_fix" | "none";
  sub_checks?: SubCheckResult[]; // Granular sub-checks evaluated by the agent
};
