/**
 * tools/llm-response.ts — Expected JSON shape of each LLM tool's response,
 * plus the shared parser that validates a chat() response against one of
 * these schemas before any pipeline code trusts it.
 *
 * A real LLM response can't be trusted to be clean JSON even with an
 * explicit "respond with ONLY JSON" instruction -- parseLLMJson() strips
 * common wrapping (markdown fences, stray whitespace) and validates with
 * zod, so a malformed response fails loudly here instead of silently
 * corrupting downstream findings.
 */

import { z } from "zod";
import { CLAIM_CATEGORIES } from "../types.ts";

const SEVERITY_SCORE = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

/**
 * The extraction model only needs to say WHICH segment_ids belong to the
 * same claim -- timestamps/source are looked up from the original segments
 * afterward (see tools/claims-extraction.ts), not trusted from the model.
 */
export const ExtractionResponseSchema = z.array(z.object({
  claim_id: z.string(),
  text: z.string(),
  segment_ids: z.array(z.string()).min(1),
}));

export const TriageResponseSchema = z.array(z.object({
  claim_id: z.string(),
  is_verifiable_claim: z.boolean(),
  category: z.enum(CLAIM_CATEGORIES).nullable(),
  reasoning: z.string(),
}));

export const SubstantiationResponseSchema = z.array(z.object({
  claim_id: z.string(),
  severity: SEVERITY_SCORE,
  issue_description: z.string(),
  recommendation: z.string(),
  confidence_score: z.number().min(0).max(1),
}));

/** Excludes excerpt_verified -- that's set afterward by verifyPolicyExcerpts() in metrics.ts, not by the model. */
export const ComplianceResponseSchema = z.array(z.object({
  claim_id: z.string(),
  severity: SEVERITY_SCORE,
  policy_excerpt: z.string(),
  issue_description: z.string(),
  recommendation: z.string(),
  confidence_score: z.number().min(0).max(1),
}));

export function parseLLMJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(
      `${context}: LLM response was not valid JSON (${
        (e as Error).message
      }). ` +
        `Raw response (first 300 chars): ${raw.slice(0, 300)}`,
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
