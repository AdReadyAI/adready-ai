/**
 * tools/claims-substantiation.ts — ClaimSubstantiationAgent.
 *
 * Judges EVERY verifiable claim's Product Truth support in ONE batched
 * call. See prompts/substantiation.ts for the prompt.
 */

import { chat } from "../../shared/llm.ts";
import type { ParsedCreativeBrief, ProductContext } from "../../shared/schemas.ts";
import {
  buildSubstantiationUserPrompt,
  SUBSTANTIATION_SYSTEM_PROMPT,
} from "../prompts/substantiation.ts";
import type {
  ClaimSubstantiationAgent,
  EvidenceByCategory,
  SubstantiationFinding,
  VerifiableClaim,
} from "../types.ts";
import { parseLLMJson, SubstantiationResponseSchema } from "./llm-response.ts";

const SUBSTANTIATION_MODEL = Deno.env.get("OPENROUTER_MODEL_SUBSTANTIATION") ??
  Deno.env.get("OPENROUTER_MODEL");

/**
 * Pure: parses/validates the raw LLM response and applies the
 * missing-claim fallback. No network call, no Deno.env access.
 */
export function processSubstantiationResponse(
  raw: string,
  claims: VerifiableClaim[],
): SubstantiationFinding[] {
  const parsed = parseLLMJson(raw, SubstantiationResponseSchema, "claims-substantiation");
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  return claims.map((claim): SubstantiationFinding => {
    const result = byId.get(claim.claim_id);
    if (result) return result;
    // Conservative default: a claim the model skipped isn't assumed fine.
    return {
      claim_id: claim.claim_id,
      severity: 2,
      issue_description:
        "Substantiation response did not cover this claim; flagged for manual review.",
      recommendation: "Review this claim manually against the product page and creative brief.",
      confidence_score: 0.2,
    };
  });
}

export const substantiateClaims: ClaimSubstantiationAgent = async (
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  brief: ParsedCreativeBrief,
  productContext: ProductContext | undefined,
): Promise<SubstantiationFinding[]> => {
  if (claims.length === 0) return [];

  const raw = await chat(
    [
      { role: "system", content: SUBSTANTIATION_SYSTEM_PROMPT },
      { role: "user", content: buildSubstantiationUserPrompt(claims, evidence, brief, productContext) },
    ],
    SUBSTANTIATION_MODEL,
  );

  return processSubstantiationResponse(raw, claims);
};