/**
 * claims-agent/agent.ts — Claims Accuracy Agent orchestration.
 *
 * Owns the full pipeline: load context, extract claim candidates, triage,
 * retrieve evidence, substantiate + check compliance (each in ONE batched
 * call across every claim), run the anti-hallucination guard, then
 * synthesize into schema-validated MetricResults.
 */

import { MetricResultSchema } from "../shared/schemas.ts";
import type { MetricResult } from "../shared/schemas.ts";

import {
  evaluatePolicyCompliance,
  evaluateProductTruth,
  verifyPolicyExcerpts,
} from "./metrics.ts";
import { getAgentContext } from "./tools/context.ts";
import { deriveClaimCandidates } from "./tools/claims-extraction.ts";
import { triageClaims } from "./tools/claims-triage.ts";
import { retrieveEvidence } from "./tools/evidence-retriever.ts";
import { substantiateClaims } from "./tools/claims-substantiation.ts";
import { checkCompliance } from "./tools/compliance-check.ts";
import type { EvidenceByCategory, VerifiableClaim } from "./types.ts";
import { uniqueCategories } from "./utils.ts";

export type ClaimsAgentDependencies = {
  getAgentContext: typeof getAgentContext;
  deriveClaimCandidates: typeof deriveClaimCandidates;
  triageClaims: typeof triageClaims;
  retrieveEvidence: typeof retrieveEvidence;
  substantiateClaims: typeof substantiateClaims;
  checkCompliance: typeof checkCompliance;
  verifyPolicyExcerpts: typeof verifyPolicyExcerpts;
  evaluateProductTruth: typeof evaluateProductTruth;
  evaluatePolicyCompliance: typeof evaluatePolicyCompliance;
};

export const claimsAgentDependencies: ClaimsAgentDependencies = {
  getAgentContext,
  deriveClaimCandidates,
  triageClaims,
  retrieveEvidence,
  substantiateClaims,
  checkCompliance,
  verifyPolicyExcerpts,
  evaluateProductTruth,
  evaluatePolicyCompliance,
};

/**
 * Runs the Claims Accuracy Agent end-to-end for a single request.
 */
export async function runClaimsAgent(
  requestId: string,
  deps: ClaimsAgentDependencies = claimsAgentDependencies,
): Promise<MetricResult[]> {
  const context = await deps.getAgentContext(requestId);

  // Extract claim candidates (single batched pass).
  const candidates = await deps.deriveClaimCandidates(
    context.transcript_segments,
    context.ocr_segments,
  );

  // Triage ALL candidates in one batched call.
  const triage = await deps.triageClaims(
    candidates,
    context.parsed_creative_brief,
  );

  const verifiableClaims: VerifiableClaim[] = candidates
    .map((claim) => {
      const t = triage.find((r) => r.claim_id === claim.claim_id);
      return t?.is_verifiable_claim && t.category
        ? { ...claim, category: t.category }
        : null;
    })
    .filter((c): c is VerifiableClaim => c !== null);

  // Retrieval batched by UNIQUE category, not by claim.
  const categories = uniqueCategories(triage);
  const productEvidence: EvidenceByCategory = {};
  const regulatoryEvidence: EvidenceByCategory = {};
  for (const category of categories) {
    productEvidence[category] = await deps.retrieveEvidence(
      category,
      "product",
    );
    regulatoryEvidence[category] = await deps.retrieveEvidence(
      category,
      "regulatory",
    );
  }

  // Substantiate ALL verifiable claims in one batched call.
  const substantiationFindings = await deps.substantiateClaims(
    verifiableClaims,
    productEvidence,
    context.parsed_creative_brief,
    context.product_context,
  );

  // Check compliance for ALL verifiable claims in one batched call.
  const rawComplianceFindings = await deps.checkCompliance(
    verifiableClaims,
    regulatoryEvidence,
    context.ocr_segments,
    context.parsed_creative_brief,
  );

  // Anti-hallucination guard — always runs.
  const complianceFindings = deps.verifyPolicyExcerpts(
    rawComplianceFindings,
    verifiableClaims,
    regulatoryEvidence,
  );

  // Synthesis
  const results: MetricResult[] = [
    deps.evaluateProductTruth(candidates, triage, substantiationFindings),
    deps.evaluatePolicyCompliance(
      candidates,
      context.ocr_segments,
      complianceFindings,
      context.parsed_creative_brief,
    ),
  ];

  return MetricResultSchema.array().parse(results);
}
