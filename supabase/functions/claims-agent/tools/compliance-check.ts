/**
 * tools/compliance-check.ts — ComplianceCheckAgent.
 *
 * Judges EVERY verifiable claim's Policy/Compliance readiness. Splits into
 * TWO batched calls by risk tier: health/medical and safety claims (real
 * regulatory exposure) escalate to a stronger model; everything else uses
 * the standard tier. Each half is still one call across every claim in
 * that tier, not one call per claim. See prompts/compliance.ts for the
 * prompt.
 *
 * NOTE: policy_excerpt is NOT trusted as-is here. verifyPolicyExcerpts() in
 * ../metrics.ts always runs on the output afterward and drops/caps any
 * excerpt that isn't found verbatim in the retrieved regulatory evidence.
 */

import { chat } from "../../shared/llm.ts";
import type { OCRSegment, ParsedCreativeBrief } from "../../shared/schemas.ts";
import { buildComplianceUserPrompt, COMPLIANCE_SYSTEM_PROMPT } from "../prompts/compliance.ts";
import type {
  ComplianceCheckAgent,
  ComplianceFinding,
  EvidenceByCategory,
  VerifiableClaim,
} from "../types.ts";
import { ComplianceResponseSchema, parseLLMJson } from "./llm-response.ts";

const STANDARD_MODEL = Deno.env.get("OPENROUTER_MODEL_COMPLIANCE") ??
  Deno.env.get("OPENROUTER_MODEL");
const HIGH_STAKES_MODEL = Deno.env.get("OPENROUTER_MODEL_COMPLIANCE_HIGH_STAKES") ??
  STANDARD_MODEL;

/** Categories with real regulatory/legal exposure — escalate to the stronger model. */
export const HIGH_STAKES_CATEGORIES = new Set(["health_or_medical_claim", "safety_claim"]);

/**
 * Pure: parses/validates one batch's raw LLM response and applies the
 * missing-claim fallback. No network call, no Deno.env access.
 */
export function processComplianceResponse(
  raw: string,
  claims: VerifiableClaim[],
): ComplianceFinding[] {
  const parsed = parseLLMJson(raw, ComplianceResponseSchema, "compliance-check");
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  return claims.map((claim): ComplianceFinding => {
    const result = byId.get(claim.claim_id);
    if (result) {
      // excerpt_verified is finalized by verifyPolicyExcerpts(), not here.
      return { ...result, excerpt_verified: false };
    }
    return {
      claim_id: claim.claim_id,
      severity: 2,
      policy_excerpt: "",
      issue_description:
        "Compliance response did not cover this claim; flagged for manual review.",
      recommendation: "Review this claim manually against applicable regulations.",
      confidence_score: 0.2,
      excerpt_verified: false,
    };
  });
}

async function runComplianceBatch(
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  ocrSegments: OCRSegment[],
  model: string | undefined,
): Promise<ComplianceFinding[]> {
  if (claims.length === 0) return [];

  const raw = await chat(
    [
      { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
      { role: "user", content: buildComplianceUserPrompt(claims, evidence, ocrSegments) },
    ],
    model,
  );

  return processComplianceResponse(raw, claims);
}

export const checkCompliance: ComplianceCheckAgent = async (
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  ocrSegments: OCRSegment[],
  _brief: ParsedCreativeBrief,
): Promise<ComplianceFinding[]> => {
  const highStakes = claims.filter((c) => HIGH_STAKES_CATEGORIES.has(c.category));
  const standard = claims.filter((c) => !HIGH_STAKES_CATEGORIES.has(c.category));

  const [highStakesResults, standardResults] = await Promise.all([
    runComplianceBatch(highStakes, evidence, ocrSegments, HIGH_STAKES_MODEL),
    runComplianceBatch(standard, evidence, ocrSegments, STANDARD_MODEL),
  ]);

  // Preserve the original claim order in the returned array.
  const byId = new Map([...highStakesResults, ...standardResults].map((r) => [r.claim_id, r]));
  return claims.map((c) => byId.get(c.claim_id)!);
};