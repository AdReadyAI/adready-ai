/** Prompt construction for the Product Representation evaluator. */

import type { ChatMessage } from "../shared/llm.ts";
import type { AgentContext } from "../shared/schemas.ts";

/**
 * Build the complete migration-backed evidence payload consumed by the model.
 *
 * A single obscured or reference-mismatched appearance can be decisive, so this
 * evaluator does not discard detections through blind temporal sampling.
 */
export function buildProductRepresentationInput(
  context: AgentContext,
): string {
  const visualById = new Map(
    context.visual_frames.map((frame) => [frame.frame_id, frame]),
  );

  return JSON.stringify({
    creative_brief: {
      source_id: "creative_brief",
      raw_text: context.parsed_creative_brief.raw_text,
      required_messages: context.parsed_creative_brief.required_messages,
    },
    product_context: context.product_context
      ? { source_id: "product_context", ...context.product_context }
      : undefined,
    product_frames: context.product_frames.map((frame) => {
      const visual = visualById.get(frame.frame_id);
      return {
        frame_id: frame.frame_id,
        timestamp_ms: frame.timestamp_ms,
        confidence_score: frame.confidence_score,
        prominence: frame.prominence,
        focus_quality: frame.focus_quality,
        framing: frame.framing,
        action: visual?.action,
        framing_composition: visual?.framing_composition,
      };
    }),
    logo_frames: context.logo_frames.map((frame) => {
      const visual = visualById.get(frame.frame_id);
      return {
        frame_id: frame.frame_id,
        timestamp_ms: frame.timestamp_ms,
        confidence_score: frame.confidence_score,
        prominence: frame.prominence,
        reference_match: frame.reference_match,
        action: visual?.action,
        framing_composition: visual?.framing_composition,
      };
    }),
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
    })),
    video_duration_ms: context.video_metadata.duration_ms,
  });
}

/**
 * Build the single-call Product Representation prompt.
 *
 * The model judges the four owned sub-checks. Agent code owns roll-up and does
 * not accept a model-authored metric result as authoritative.
 */
export function productRepresentationPrompt(
  context: AgentContext,
): ChatMessage[] {
  const system =
    "You are the Product Representation evaluator for a pre-launch video-ad " +
    "review. Use only the supplied Product References and Media Evidence. You " +
    "never see the raw video or fetch reference URLs. Evaluate exactly four " +
    "sub-checks: product_not_shown, product_obscured, " +
    "product_appearance_wrong, and product_name_unspoken. A missing detection " +
    "is not proof that a product is absent when the remaining visual evidence " +
    "is too sparse; return cannot_assess in that case. Evaluate appearance " +
    "against explicit reference-derived signals only. A URL count alone cannot " +
    "prove an appearance match or mismatch. Do not invent screen-time coverage " +
    "from the number of product and visual samples. Cite only supplied segment " +
    "or frame evidence. Severity none is valid only for passed checks, and " +
    "severity cannot_assess is valid only for cannot_assess checks. Return JSON " +
    "only.";

  const outputContract = {
    confidence: "high|medium|low",
    evidence: [
      {
        type: "product_page|transcript|ocr|visual|brief|metadata",
        source_id: "supplied source_id",
        text: "supplied evidence",
        timestamp: "MM:SS, range, or empty for untimed source evidence",
      },
    ],
    explanation: "metric-level explanation",
    suggested_correction: "actionable correction for a failure only",
    correction_type: "rewrite|edit_recommendation|technical_fix|none",
    sub_checks: [
      {
        check_id:
          "product_not_shown|product_obscured|product_appearance_wrong|product_name_unspoken",
        result: "passed|failed|cannot_assess",
        severity: "none|low|medium|high|critical|cannot_assess",
        explanation: "evidence-grounded reason",
      },
    ],
  };

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Return exactly this JSON structure:\n${
        JSON.stringify(outputContract)
      }\n\nReview input:\n${buildProductRepresentationInput(context)}`,
    },
  ];
}
