/**
 * agent.ts — Claims Accuracy Agent orchestration.
 */

import { loadAgentContext, validateMetricResults } from "../shared/index.ts";
import type { AgentRunRequest, MetricResult } from "../shared/index.ts";
import { extractClaims, substantiateClaims, triageClaims } from "./checks.ts";
import type { VerifiableClaim } from "./checks.ts";
import { checkAdWidePolicy } from "./policy.ts";
import { evaluatePolicyCompliance, evaluateProductTruth } from "./metrics.ts";

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

  const [substantiationFindings, adWidePolicy] = await Promise.all([
    substantiateClaims(
      verifiableClaims,
      context.parsed_creative_brief,
      context.product_context,
    ),
    checkAdWidePolicy(
      context.transcript_segments,
      context.ocr_segments,
      context.parsed_creative_brief,
    ),
  ]);

  const results: MetricResult[] = [
    evaluateProductTruth(candidates, triage, substantiationFindings),
    evaluatePolicyCompliance(
      adWidePolicy,
      context.transcript_segments,
      context.ocr_segments,
    ),
  ];

  return validateMetricResults(results);
}
