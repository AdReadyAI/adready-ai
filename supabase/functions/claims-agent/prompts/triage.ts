/**
 * prompts/triage.ts — Prompt for tools/claims-triage.ts.
 *
 * Classifies every candidate claim in one batched call: real, checkable
 * claim vs. brand puffery, plus a category for claims that are checkable.
 */

import type { ParsedCreativeBrief } from "../../shared/schemas.ts";
import { CLAIM_CATEGORIES } from "../types.ts";
import type { DerivedClaim } from "../types.ts";

export const TRIAGE_SYSTEM_PROMPT =
  `You are a claim triage classifier for advertising compliance review.

For each claim, decide:
- is_verifiable_claim: true if it asserts a specific, checkable fact (efficacy, composition, comparison, price, endorsement, safety). false if it's brand mood language, a slogan, or figurative language -- "Red Bull gives you wings" is false, since no reasonable viewer reads it as a literal claim about giving anyone wings.
- category: one of [${
    CLAIM_CATEGORIES.join(", ")
  }] when verifiable, or null when not verifiable.
- reasoning: one sentence.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape, one object per claim:
[{"claim_id": "...", "is_verifiable_claim": true, "category": "...", "reasoning": "..."}]`;

export function buildTriageUserPrompt(
  claims: DerivedClaim[],
  brief: ParsedCreativeBrief,
): string {
  return [
    `Brand voice: ${brief.brand_voice ?? "(not specified)"}`,
    `Required messages the brand wants included (these are legitimate substantive claims, not puffery, when they appear): ${
      JSON.stringify(brief.required_messages)
    }`,
    "",
    "Claims to classify:",
    ...claims.map((c) => `- ${c.claim_id}: "${c.text}"`),
  ].join("\n");
}
