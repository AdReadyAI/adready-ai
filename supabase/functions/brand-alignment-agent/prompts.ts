import { z } from "zod";

import { chat } from "../shared/index.ts";

import type { AgentContext, ConfidenceLevel } from "../shared/index.ts";

import { makeCheck, toEvidence } from "./checks.ts";

import type { CheckAssessment } from "./checks.ts";

export const LLMCheckSchema = z.object({
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: z.enum([
    "none",
    "low",
    "medium",
    "high",
    "critical",
    "cannot_assess",
  ]),
  confidence: z.enum(["low", "medium", "high"]),
  explanation: z.string(),
  evidence: z.array(
    z.object({
      type: z.enum(["transcript", "ocr", "visual", "brief"]),
      text: z.string(),
      timestamp_ms: z.number().int().nonnegative().optional(),
    }),
  ).optional().default([]),
});

export const LLMAssessmentSchema = z.object({
  color_palette_off: LLMCheckSchema,
  brand_voice_drift: LLMCheckSchema,
});

export type LLMAssessment = z.infer<typeof LLMAssessmentSchema>;

/**
 * Overrides qualitative checks to cannot_assess when corresponding guidance is absent.
 */
export function applyGuidanceGuards(
  assessment: LLMAssessment,
  hasPaletteGuidance: boolean,
  hasVoiceGuidance: boolean,
): LLMAssessment {
  if (!hasPaletteGuidance) {
    assessment.color_palette_off = {
      result: "cannot_assess",
      severity: "cannot_assess",
      confidence: "low",
      explanation: "No palette, typography, or color guidance was supplied.",
      evidence: [],
    };
  }

  if (!hasVoiceGuidance) {
    assessment.brand_voice_drift = {
      result: "cannot_assess",
      severity: "cannot_assess",
      confidence: "low",
      explanation: "No brand voice guidance was supplied.",
      evidence: [],
    };
  }

  return assessment;
}

function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  if (start === -1) {
    throw new Error("LLM response did not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index++) {
    const character = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(content.slice(start, index + 1));
      }
    }
  }

  throw new Error("LLM response contained an incomplete JSON object.");
}

function confidence(
  left: ConfidenceLevel,
  right: ConfidenceLevel,
): ConfidenceLevel {
  if (left === "low" || right === "low") return "low";
  if (left === "medium" || right === "medium") return "medium";
  return "high";
}

function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from(
    { length: limit },
    (_, index) => items[Math.floor((index * (items.length - 1)) / (limit - 1))],
  );
}

/** Evaluates qualitative color palette and brand voice checks via LLM. */
export async function evaluateQualitativeChecks(
  context: AgentContext,
): Promise<CheckAssessment> {
  const hasPaletteGuidance = context.parsed_creative_brief.brand_guidelines
    .some(
      (guideline) => /color|colour|palette|typography|font/i.test(guideline),
    );
  const hasVoiceGuidance = Boolean(context.parsed_creative_brief.brand_voice);

  if (!hasPaletteGuidance && !hasVoiceGuidance) {
    return {
      checks: [
        makeCheck(
          "color_palette_off",
          "Color Scheme Alignment",
          "cannot_assess",
          "cannot_assess",
          "No palette, typography, or color guidance was supplied.",
        ),
        makeCheck(
          "brand_voice_drift",
          "Brand Voice Alignment",
          "cannot_assess",
          "cannot_assess",
          "No brand voice guidance was supplied.",
        ),
      ],
      evidence: [],
      confidence: "low",
    };
  }

  const promptContext = {
    brand_voice: context.parsed_creative_brief.brand_voice,
    brand_guidelines: context.parsed_creative_brief.brand_guidelines,
    visual_frames: sampleEvenly(context.visual_frames, 12).map((frame) => ({
      timestamp_ms: frame.timestamp_ms,
      description: frame.action,
      color_palette: frame.color_palette,
    })),
    transcript_segments: sampleEvenly(context.transcript_segments, 20).map((
      segment,
    ) => ({
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
    })),
    ocr_segments: sampleEvenly(context.ocr_segments, 20).map((segment) => ({
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
    })),
  };

  try {
    const content = await chat([
      {
        role: "system",
        content:
          "You are a brand-safety evaluator. Use only supplied evidence. Return JSON only. Mark a check cannot_assess when its corresponding guidance or evidence is missing. A palette failure requires explicit palette, color, typography, or font guidance. A voice failure requires explicit brand voice guidance.",
      },
      {
        role: "user",
        content:
          `Evaluate the two checks below and return exactly this JSON shape: {"color_palette_off":{"result":"passed|failed|cannot_assess","severity":"none|low|medium|high|critical|cannot_assess","confidence":"low|medium|high","explanation":"...","evidence":[{"type":"transcript|ocr|visual|brief","text":"...","timestamp_ms":0}]},"brand_voice_drift":{...}}.\n\nContext:\n${
            JSON.stringify(promptContext)
          }`,
      },
    ]);

    console.info(
      JSON.stringify({
        event: "brand_alignment.llm_completed",
        configured_model: Deno.env.get("OPENROUTER_MODEL"),
      }),
    );

    const assessment = LLMAssessmentSchema.parse(extractJson(content));
    const guardedAssessment = applyGuidanceGuards(
      assessment,
      hasPaletteGuidance,
      hasVoiceGuidance,
    );

    const toAssessment = (
      check_id: "color_palette_off" | "brand_voice_drift",
      name: string,
    ) => {
      const item = guardedAssessment[check_id];
      return {
        check: makeCheck(
          check_id,
          name,
          item.result,
          item.severity,
          item.explanation,
        ),
        evidence: item.evidence.map((itemEvidence) =>
          toEvidence(
            itemEvidence.type,
            itemEvidence.text,
            itemEvidence.timestamp_ms,
          )
        ),
        confidence: item.confidence,
      };
    };

    const palette = toAssessment("color_palette_off", "Color Scheme Alignment");
    const voice = toAssessment("brand_voice_drift", "Brand Voice Alignment");

    return {
      checks: [palette.check, voice.check],
      evidence: [...palette.evidence, ...voice.evidence],
      confidence: confidence(palette.confidence, voice.confidence),
    };
  } catch (error) {
    console.error("[brand-alignment-agent] qualitative evaluation failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    const explanation = "Qualitative brand evaluation could not be completed.";

    return {
      checks: [
        makeCheck(
          "color_palette_off",
          "Color Scheme Alignment",
          "cannot_assess",
          "cannot_assess",
          explanation,
        ),
        makeCheck(
          "brand_voice_drift",
          "Brand Voice Alignment",
          "cannot_assess",
          "cannot_assess",
          explanation,
        ),
      ],
      evidence: [],
      confidence: "low",
    };
  }
}
