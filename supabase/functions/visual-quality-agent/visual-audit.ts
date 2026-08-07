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
  const userPrompt = buildVisualAuditUserPrompt({
    video_metadata: context.video_metadata,

    ocr_segments: context.ocr_segments,

    visual_frames: context.visual_frames,

    visual_findings: context.quality_frames,
  });

  const MAX_ATTEMPTS = 3;
  let parsed: unknown;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const messages: {
      role: "system" | "assistant" | "user";
      content: string;
    }[] = [
      { role: "system", content: VISUAL_AUDIT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];
    if (attempt > 0) {
      messages.push({ role: "assistant", content: "(invalid JSON)" });
      messages.push({
        role: "user",
        content:
          "Your previous response was not valid JSON. Respond with ONLY valid JSON matching the requested schema, with no other text.",
      });
    }
    const response = await chat(messages);

    try {
      parsed = parseLLMJson(response);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (parsed === undefined) throw lastError;

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

function extractJsonSubstring(raw: string): string {
  const candidates: string[] = [];
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    candidates.push(raw.slice(arrStart, arrEnd + 1));
  }
  const objStart = raw.indexOf("{");
  const objEnd = raw.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    candidates.push(raw.slice(objStart, objEnd + 1));
  }
  return candidates.sort((a, b) => b.length - a.length)[0] ?? raw;
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
    try {
      return JSON.parse(extractJsonSubstring(cleaned));
    } catch {
      throw new Error(
        `Visual quality LLM returned invalid JSON. Raw response (first 300 chars): ${
          content.slice(0, 300)
        }`,
      );
    }
  }
}
