/**
 * agent.ts — Claims Accuracy Agent orchestration.
 *
 * Loads context (shared/context.ts), runs the four checks in checks.ts
 * (each ONE batched call across every claim), retrieves evidence via
 * rag.ts (once per unique category), then synthesizes into
 * schema-validated MetricResults via metrics.ts and shared/validation.ts.
 */

import { loadAgentContext, validateMetricResults } from "../shared/index.ts";
import type { AgentRunRequest, MetricResult } from "../shared/index.ts";
import {
  checkCompliance,
  extractClaims,
  substantiateClaims,
  triageClaims,
  verifyPolicyExcerpts,
} from "./checks.ts";
import type { EvidenceByCategory, VerifiableClaim } from "./checks.ts";
import { evaluatePolicyCompliance, evaluateProductTruth } from "./metrics.ts";
import { retrieveEvidence, uniqueCategories } from "./rag.ts";

/**
 * Runs the Claims Accuracy Agent end-to-end for a single request.
 *
 * `userId` is required -- shared/context.ts authorizes the request against
 * it before loading any related data (see that file's header).
 */
export async function runClaimsAgent(
  request: AgentRunRequest,
  { userId }: { userId: string },
): Promise<MetricResult[]> {
  const context = await loadAgentContext(request.request_id, { userId });

  // Extract claim candidates (already a single batched pass, dedupes repeats).
  const candidates = await extractClaims(
    context.transcript_segments,
    context.ocr_segments,
  );

  // Triage ALL candidates in one batched call.
  const triage = await triageClaims(candidates, context.parsed_creative_brief);

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
    productEvidence[category] = await retrieveEvidence(category, "product");
    regulatoryEvidence[category] = await retrieveEvidence(
      category,
      "regulatory",
    );
  }

  // Substantiate ALL verifiable claims in one batched call.
  const substantiationFindings = await substantiateClaims(
    verifiableClaims,
    productEvidence,
    context.parsed_creative_brief,
    context.product_context,
  );

  // Check compliance for ALL verifiable claims in one batched call.
  const rawComplianceFindings = await checkCompliance(
    verifiableClaims,
    regulatoryEvidence,
    context.ocr_segments,
    context.parsed_creative_brief,
  );

  // Anti-hallucination guard -- always runs.
  const complianceFindings = verifyPolicyExcerpts(
    rawComplianceFindings,
    verifiableClaims,
    regulatoryEvidence,
  );

  // Synthesis (pure, deterministic), then the shared semantic validator
  // (result/severity consistency, no duplicate metrics) before returning.
  const results: MetricResult[] = [
    evaluateProductTruth(candidates, triage, substantiationFindings),
    evaluatePolicyCompliance(
      candidates,
      context.ocr_segments,
      complianceFindings,
      context.parsed_creative_brief,
    ),
  ];

  return validateMetricResults(results);
}
