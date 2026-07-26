/**
 * tools/claims-triage.ts — ClaimTriageAgent.
 *
 * Classifies EVERY candidate claim in ONE batched call: real, checkable
 * claim vs. brand puffery, plus a category for claims that are checkable.
 * See prompts/triage.ts for the prompt.
 */

import { chat } from "../../shared/llm.ts";
import type { ParsedCreativeBrief } from "../../shared/schemas.ts";
import { buildTriageUserPrompt, TRIAGE_SYSTEM_PROMPT } from "../prompts/triage.ts";
import type { ClaimTriageAgent, DerivedClaim, TriageResult } from "../types.ts";
import { parseLLMJson, TriageResponseSchema } from "./llm-response.ts";

const TRIAGE_MODEL = Deno.env.get("OPENROUTER_MODEL_TRIAGE") ?? Deno.env.get("OPENROUTER_MODEL");

/**
 * Pure: parses/validates the raw LLM response and applies the
 * missing-claim fallback. No network call, no Deno.env access.
 */
export function processTriageResponse(raw: string, claims: DerivedClaim[]): TriageResult[] {
  const parsed = parseLLMJson(raw, TriageResponseSchema, "claims-triage");
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  // Mapping over `claims` (not `parsed`) means any unrecognized claim_id the
  // model invented is implicitly dropped.
  return claims.map((claim): TriageResult => {
    const result = byId.get(claim.claim_id);
    if (result) return result;
    // The model didn't return a result for this claim -- default to
    // verifiable rather than silently treating it as puffery. A false
    // negative here (a real claim skipped as puffery) means it never
    // reaches substantiation or compliance at all.
    return {
      claim_id: claim.claim_id,
      is_verifiable_claim: true,
      category: "factual_claim",
      reasoning:
        "Triage response did not cover this claim; defaulting to verifiable for safety.",
    };
  });
}

export const triageClaims: ClaimTriageAgent = async (
  claims: DerivedClaim[],
  brief: ParsedCreativeBrief,
): Promise<TriageResult[]> => {
  if (claims.length === 0) return [];

  const raw = await chat(
    [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: buildTriageUserPrompt(claims, brief) },
    ],
    TRIAGE_MODEL,
  );

  return processTriageResponse(raw, claims);
};