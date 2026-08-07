/** Prompt construction for the Brief Alignment evaluator. */

import type { ChatMessage } from "../shared/llm.ts";
import type { AgentContext } from "../shared/schemas.ts";

/**
 * Build the complete migration-backed evidence payload consumed by the model.
 *
 * Brief and audience violations can be momentary, so this evaluator does not
 * discard evidence through blind temporal sampling. Prompt-size optimization
 * requires measured limits and an agent-specific relevance policy.
 */
export function buildBriefAlignmentInput(context: AgentContext): string {
  return JSON.stringify({
    campaign_context: {
      campaign_goal: {
        source_id: "campaign_goal",
        text: context.campaign_goal,
      },
      destination_platform: context.destination_platform,
      creative_brief: {
        source_id: "creative_brief",
        raw_text: context.parsed_creative_brief.raw_text,
        target_audience: context.parsed_creative_brief.target_audience,
        brand_voice: context.parsed_creative_brief.brand_voice,
        required_messages: context.parsed_creative_brief.required_messages,
      },
    },
    transcript_segments: context.transcript_segments.map(
      (segment) => ({
        segment_id: segment.segment_id,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        text: segment.text,
      }),
    ),
    ocr_segments: context.ocr_segments.map((segment) => ({
      ocr_id: segment.ocr_id,
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
    })),
    visual_frames: context.visual_frames.map((frame) => ({
      frame_id: frame.frame_id,
      timestamp_ms: frame.timestamp_ms,
      action: frame.action,
      framing_composition: frame.framing_composition,
      people: frame.people,
      color_palette: frame.color_palette,
      background: frame.background,
    })),
    product_frames: context.product_frames.map((frame) => ({
      frame_id: frame.frame_id,
      timestamp_ms: frame.timestamp_ms,
      prominence: frame.prominence,
      focus_quality: frame.focus_quality,
      framing: frame.framing,
    })),
  });
}

/**
 * Build the single-call Brief Alignment prompt.
 *
 * The model judges sub-checks only. Agent code owns metric roll-up so optional
 * prose or corrections can never silently change a verdict.
 */
export function briefAlignmentPrompt(context: AgentContext): ChatMessage[] {
  const system =
    "You are the Brief Alignment evaluator for a pre-launch video-ad review. " +
    "Use only the supplied Campaign Context and Media Evidence. You never see " +
    "the raw video. Evaluate exactly four sub-checks grouped under exactly two " +
    "metrics. brief_adherence contains objective_missed and " +
    "required_message_missing. audience_fit contains demographic_mismatch and " +
    "demographic_restricted. Do not evaluate platform format, placement " +
    "conventions, technical quality, logo correctness, or general Brand Fit. " +
    "Return cannot_assess when the relevant Review Input is absent; never infer " +
    "an audience from detected people alone. Cite only supplied segment or frame " +
    "evidence. Severity none is valid only for passed checks, and severity " +
    "cannot_assess is valid only for cannot_assess checks. Return JSON only.";

  const outputContract = {
    metrics: [
      {
        metric_id: "brief_adherence",
        confidence: "high|medium|low",
        evidence: [
          {
            type: "brief|transcript|ocr|visual|metadata",
            source_id: "supplied source_id",
            text: "supplied evidence",
            timestamp: "MM:SS, range, or empty for untimed brief evidence",
          },
        ],
        explanation: "metric-level explanation",
        suggested_correction: "actionable correction for a failure only",
        correction_type: "rewrite|edit_recommendation|technical_fix|none",
        sub_checks: [
          {
            check_id: "objective_missed|required_message_missing",
            result: "passed|failed|cannot_assess",
            severity: "none|low|medium|high|critical|cannot_assess",
            explanation: "evidence-grounded reason",
          },
        ],
      },
      {
        metric_id: "audience_fit",
        confidence: "high|medium|low",
        evidence: [],
        explanation: "metric-level explanation",
        suggested_correction: "actionable correction for a failure only",
        correction_type: "rewrite|edit_recommendation|technical_fix|none",
        sub_checks: [
          {
            check_id: "demographic_mismatch|demographic_restricted",
            result: "passed|failed|cannot_assess",
            severity: "none|low|medium|high|critical|cannot_assess",
            explanation: "evidence-grounded reason",
          },
        ],
      },
    ],
  };

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Return exactly this JSON structure:\n${
        JSON.stringify(outputContract)
      }\n\nReview input:\n${buildBriefAlignmentInput(context)}`,
    },
  ];
}
