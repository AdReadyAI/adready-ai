/**
 * policy.ts — Ad-wide policy checks: disclaimer presence/adequacy and
 * depicted policy violations. Not per-claim -- one batched LLM call per ad.
 */

import { z } from "zod";
import { chat } from "../shared/index.ts";
import type {
  OCRSegment,
  ParsedCreativeBrief,
  TranscriptSegment,
} from "../shared/index.ts";
import {
  AD_WIDE_POLICY_SYSTEM_PROMPT,
  buildAdWidePolicyUserPrompt,
} from "./prompts.ts";
import type { SeverityScore } from "./checks.ts";

export type DisclaimerAssessment = {
  required: boolean;
  present: boolean;
  matched_segment_id: string | null;
  matched_source: "transcript" | "ocr" | null;
  explanation: string;
  confidence_score: number;
};

export type PolicyDepictionFinding = {
  detected: boolean;
  severity: SeverityScore;
  description: string;
  matched_segment_id: string | null;
  matched_source: "transcript" | "ocr" | null;
  confidence_score: number;
};

export type AdWidePolicyAssessment = {
  disclaimer: DisclaimerAssessment;
  policy_depiction: PolicyDepictionFinding;
};

const SEVERITY_SCORE = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const AdWidePolicyResponseSchema = z.object({
  disclaimer: z.object({
    required: z.boolean(),
    present: z.boolean(),
    matched_segment_id: z.string().nullable(),
    matched_source: z.enum(["transcript", "ocr"]).nullable(),
    explanation: z.string(),
    confidence_score: z.number().min(0).max(1),
  }),
  policy_depiction: z.object({
    detected: z.boolean(),
    severity: SEVERITY_SCORE,
    description: z.string(),
    matched_segment_id: z.string().nullable(),
    matched_source: z.enum(["transcript", "ocr"]).nullable(),
    confidence_score: z.number().min(0).max(1),
  }),
});

function parseLLMJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(
    /```\s*$/i,
    "",
  ).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(
      `${context}: LLM response was not valid JSON (${
        (e as Error).message
      }). Raw response (first 300 chars): ${raw.slice(0, 300)}`,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `${context}: LLM response did not match the expected shape: ${result.error.message}`,
    );
  }
  return result.data;
}

export function processAdWidePolicyResponse(
  raw: string,
): AdWidePolicyAssessment {
  return parseLLMJson(raw, AdWidePolicyResponseSchema, "ad-wide-policy");
}

export async function checkAdWidePolicy(
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
  brief: ParsedCreativeBrief,
): Promise<AdWidePolicyAssessment> {
  const raw = await chat([
    { role: "system", content: AD_WIDE_POLICY_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildAdWidePolicyUserPrompt(transcript, ocr, brief),
    },
  ]);
  return processAdWidePolicyResponse(raw);
}
