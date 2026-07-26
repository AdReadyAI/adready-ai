/**
 * visual-quality-agent/tools/visual-audit.ts — LLM-assisted visual audit.
 *
 * Sends frame-level visual context and technical metadata to the configured
 * OpenRouter LLM for visual quality analysis.
 *
 * The audit evaluates only:
 * - ai_artifacts,
 * - poor_framing_lighting,
 * - jarring_transitions.
 *
 * The LLM response is parsed and validated against a dedicated internal
 * schema before being passed to the deterministic synthesis layer.
 *
 * This module does not calculate the final production_readiness metric.
 */

import { z } from "zod";

import type { AgentContext } from "../../shared/schemas.ts";

import { chat } from "../../shared/llm.ts";

import {
  buildVisualAuditUserPrompt,
  VISUAL_AUDIT_SYSTEM_PROMPT,
} from "../prompts/visual-audit.ts";

import type { VisualAuditFinding, VisualAuditLLMResponse } from "../types.ts";

const VisualAuditResponseSchema = z.object({
  findings: z.array(
    z.object({
      check_id: z.enum([
        "ai_artifacts",
        "poor_framing_lighting",
        "jarring_transitions",
      ]),

      severity: z.number().int().min(0).max(4),

      explanation: z.string(),

      evidence_text: z.string(),

      evidence_timestamp_ms: z
        .number()
        .int()
        .nonnegative()
        .nullable(),

      confidence_score: z
        .number()
        .min(0)
        .max(1),
    }),
  ).length(3),
});

export async function auditVisualQuality(
  context: AgentContext,
): Promise<VisualAuditFinding[]> {
  const response = await chat([
    {
      role: "system",
      content: VISUAL_AUDIT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: buildVisualAuditUserPrompt({
        video_metadata: context.video_metadata,
        ocr_segments: context.ocr_segments,
        visual_frames: context.visual_frames,
      }),
    },
  ]);

  const parsed = parseLLMJson(response);

  const validated = VisualAuditResponseSchema.parse(parsed);

  return validated.findings.map((finding) => ({
    check_id: finding.check_id,
    severity: finding.severity as 0 | 1 | 2 | 3 | 4,
    explanation: finding.explanation,
    evidence_text: finding.evidence_text,
    evidence_timestamp_ms: finding.evidence_timestamp_ms,
    confidence_score: finding.confidence_score,
  }));
}

function parseLLMJson(
  content: string,
): VisualAuditLLMResponse {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(
      "Visual quality LLM returned invalid JSON.",
    );
  }
}
