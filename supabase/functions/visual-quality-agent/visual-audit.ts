import { z } from "zod";

import type { AgentContext } from "../shared/schemas.ts";

import { chat } from "../shared/llm.ts";

import {
  buildVisualAuditUserPrompt,
  VISUAL_AUDIT_SYSTEM_PROMPT,
} from "./prompts.ts";

const SeverityScoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const VisualAuditResponseSchema = z.object({
  findings: z.array(
    z.object({
      check_id: z.enum([
        "ai_artifacts",
        "poor_framing_lighting",
        "jarring_transitions",
      ]),

      severity: SeverityScoreSchema,

      explanation: z.string(),

      evidence_text: z.string(),

      evidence_timestamp_ms: z.number()
        .int()
        .nonnegative()
        .nullable(),

      confidence_score: z.number()
        .min(0)
        .max(1),
    }),
  ),
});

export type VisualAuditFinding = z.infer<
  typeof VisualAuditResponseSchema
>["findings"][number];

/**
 * Runs the LLM-assisted visual audit.
 *
 * The LLM evaluates:
 * - AI artifacts
 * - framing and lighting
 * - transition continuity
 */
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

  const validated = VisualAuditResponseSchema.parse(
    parsed,
  );

  const requiredCheckIds = [
    "ai_artifacts",
    "poor_framing_lighting",
    "jarring_transitions",
  ] as const;

  for (
    const checkId of requiredCheckIds
  ) {
    const matches = validated.findings.filter(
      (finding) =>
        finding.check_id ===
          checkId,
    );

    if (matches.length !== 1) {
      throw new Error(
        `Visual audit must return exactly one finding for ${checkId}.`,
      );
    }
  }

  return validated.findings;
}

function parseLLMJson(
  content: string,
): unknown {
  const cleaned = content
    .trim()
    .replace(
      /^```json\s*/i,
      "",
    )
    .replace(
      /^```\s*/i,
      "",
    )
    .replace(
      /\s*```$/i,
      "",
    )
    .trim();

  try {
    return JSON.parse(
      cleaned,
    );
  } catch {
    throw new Error(
      "Visual quality LLM returned invalid JSON.",
    );
  }
}
