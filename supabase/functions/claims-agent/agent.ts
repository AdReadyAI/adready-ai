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

  const candidates = await extractClaims(
    context.transcript_segments,
    context.ocr_segments,
  );

  const triage = await triageClaims(candidates, context.parsed_creative_brief);

  const verifiableClaims: VerifiableClaim[] = candidates
    .map((claim) => {
      const t = triage.find((r) => r.claim_id === claim.claim_id);
      return t?.is_verifiable_claim && t.category
        ? { ...claim, category: t.category }
        : null;
    })
    .filter((c): c is VerifiableClaim => c !== null);

  // Regulatory retrieval only, batched by UNIQUE category. Product
  // grounding comes directly from context.product_context (DB-loaded) --
  // no product RAG store anymore.
  const categories = uniqueCategories(triage);
  const regulatoryEvidenceEntries = await Promise.all(
    categories.map(async (category) =>
      [category, await retrieveEvidence(category)] as const
    ),
  );
  const regulatoryEvidence: EvidenceByCategory = Object.fromEntries(
    regulatoryEvidenceEntries,
  );

  const substantiationFindings = await substantiateClaims(
    verifiableClaims,
    context.parsed_creative_brief,
    context.product_context,
  );

  const rawComplianceFindings = await checkCompliance(
    verifiableClaims,
    regulatoryEvidence,
    context.ocr_segments,
    context.parsed_creative_brief,
  );

  const complianceFindings = verifyPolicyExcerpts(
    rawComplianceFindings,
    verifiableClaims,
    regulatoryEvidence,
  );

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
