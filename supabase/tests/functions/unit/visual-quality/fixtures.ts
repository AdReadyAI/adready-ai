/**
 * fixtures.ts — Shared builders/helpers for visual-quality-agent metrics tests.
 *
 * Extracted from metrics.test.ts so both checks.test.ts and metrics.test.ts
 * can share the same context/finding/OCR builders without duplication.
 */

import type {
  AgentContext,
  OCRSegment,
  VideoMetadata,
} from "../../../../functions/shared/schemas.ts";

import type {
  VisualAuditFinding,
} from "../../../../functions/visual-quality-agent/visual-audit.ts";

import { evaluateProductionReadiness } from "../../../../functions/visual-quality-agent/metrics.ts";

// ---------------------------------------------------------------------------
// Fixtures / builders
// ---------------------------------------------------------------------------

export const BASE_VIDEO_METADATA: VideoMetadata = {
  duration_ms: 30_000,
  aspect_ratio: "9:16",
  resolution: "1080x1920",
  dropped_frame_markers: [],
  corruption_detected: false,
};

export function buildContext(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  return {
    request_id: "11111111-1111-1111-1111-111111111111",
    campaign_goal: "Drive conversions",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text: "brief text",
      required_messages: [],
      required_ctas: [],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
    video_metadata: BASE_VIDEO_METADATA,
    transcript_segments: [],
    ocr_segments: [],
    visual_frames: [],
    product_frames: [],
    logo_frames: [],
    ...overrides,
  };
}

export function buildFinding(
  check_id: VisualAuditFinding["check_id"],
  overrides: Partial<VisualAuditFinding> = {},
): VisualAuditFinding {
  return {
    check_id,
    severity: 0,
    explanation: `${check_id} looks fine`,
    evidence_text: "",
    evidence_timestamp_ms: null,
    confidence_score: 1,
    ...overrides,
  };
}

/** The three visual findings the pipeline requires, all passing by default. */
export function buildPassingFindings(
  overrides: Partial<
    Record<VisualAuditFinding["check_id"], Partial<VisualAuditFinding>>
  > = {},
): VisualAuditFinding[] {
  return [
    buildFinding("ai_artifacts", overrides.ai_artifacts),
    buildFinding("poor_framing_lighting", overrides.poor_framing_lighting),
    buildFinding("jarring_transitions", overrides.jarring_transitions),
  ];
}

export function buildOcrSegment(
  overrides: Partial<OCRSegment> = {},
): OCRSegment {
  return {
    ocr_id: "ocr-1",
    frame_ids: ["frame-1"],
    start_ms: 1_000,
    end_ms: 2_000,
    text: "Some on-screen text",
    on_screen_duration_ms: 1_000,
    ...overrides,
  };
}

export function findSubCheck(
  result: ReturnType<typeof evaluateProductionReadiness>,
  check_id: string,
) {
  return result.sub_checks?.find((c) => c.check_id === check_id);
}
