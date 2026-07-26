/**
 * prompts/substantiation.ts — Prompt for tools/claims-substantiation.ts.
 *
 * Judges every verifiable claim's Product Truth support in one batched
 * call: is it supported by the product page / creative brief, contradicted
 * by it, or unsupported/exaggerated relative to it?
 */

import type {
  ParsedCreativeBrief,
  ProductContext,
} from "../../shared/schemas.ts";
import type { EvidenceByCategory, VerifiableClaim } from "../types.ts";

export const SUBSTANTIATION_SYSTEM_PROMPT =
  `You are a product-claims fact-checker for advertising compliance review.

For each claim, judge whether it is supported by the provided product page, product context, and creative brief.

Score severity 0-4:
  0 = fully supported
  1 = minor imprecision but essentially accurate
  2 = unsupported by the evidence provided, but plausible
  3 = exaggerated beyond what the evidence shows
  4 = directly contradicted by the evidence (e.g. asserts a clinical trial when none was run)

confidence_score is your own confidence in this judgment, 0.0-1.0.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape, one object per claim:
[{"claim_id": "...", "severity": 0, "issue_description": "...", "recommendation": "...", "confidence_score": 0.9}]`;

export function buildSubstantiationUserPrompt(
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  brief: ParsedCreativeBrief,
  productContext: ProductContext | undefined,
): string {
  return [
    `Approved claims (known-good language): ${
      JSON.stringify(brief.approved_claims)
    }`,
    `Forbidden claims (never acceptable, regardless of evidence): ${
      JSON.stringify(brief.forbidden_claims)
    }`,
    `Product page / context: ${productContext?.raw_text ?? "(not provided)"}`,
    "",
    "Claims to evaluate, with retrieved product evidence for their category:",
    ...claims.map((c) => {
      const chunks = evidence[c.category] ?? [];
      const evidenceText = chunks.length
        ? chunks.map((e) => `    - ${e.text}`).join("\n")
        : "    (no product evidence retrieved for this category)";
      return `  - ${c.claim_id} [${c.category}]: "${c.text}"\n${evidenceText}`;
    }),
  ].join("\n");
}
