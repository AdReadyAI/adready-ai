/**
 * rag.ts — Evidence retrieval for substantiation and compliance.
 *
 * Retrieves once per UNIQUE category present in the ad (see
 * uniqueCategories() below), not once per claim -- claims that share a
 * category share retrieval results.
 *
 * Currently returns fixed chunks instead of querying a real vector store --
 * there's no embeddings client or pgvector table wired up yet. When that's
 * built (query formulation, top-k, iterative reformulation, dedupe), only
 * retrieveEvidence()'s body changes; everything downstream stays the same.
 */

import type { ClaimCategory, EvidenceChunk, TriageResult } from "./checks.ts";

const PRODUCT_STORE: Partial<Record<ClaimCategory, EvidenceChunk[]>> = {
  health_or_medical_claim: [
    {
      chunk_id: "prod-1",
      source: "product_page",
      text:
        "NovaGlow key ingredient: 2% niacinamide. In an internal 1-week consumer survey, 87% of participants reported smoother-looking skin. No clinical trial has been conducted for NovaGlow.",
    },
  ],
  factual_claim: [
    {
      chunk_id: "prod-2",
      source: "product_page",
      text:
        "NovaGlow is formulated with dermatologist-recommended ingredients, including 2% niacinamide.",
    },
  ],
};

const REGULATORY_STORE: Partial<Record<ClaimCategory, EvidenceChunk[]>> = {
  health_or_medical_claim: [
    {
      chunk_id: "reg-1",
      source: "sample_guidance.txt",
      text:
        'Health and efficacy claims such as "clinically proven" assert that a controlled clinical trial took place and must be supported by evidence comparable in rigor to that claim, not by informal or internal consumer surveys alone.',
    },
  ],
  comparative_or_superlative_claim: [
    {
      chunk_id: "reg-2",
      source: "sample_guidance.txt",
      text:
        "Comparative and superlative claims that a reasonable consumer would read as objective and measurable should be supported by evidence comparable in rigor to the comparison being made.",
    },
  ],
};

const STORES = { product: PRODUCT_STORE, regulatory: REGULATORY_STORE };

export async function retrieveEvidence(
  category: ClaimCategory,
  store: "product" | "regulatory",
): Promise<EvidenceChunk[]> {
  await new Promise((resolve) => setTimeout(resolve, 100)); // simulate async retrieval
  return STORES[store][category] ?? [];
}

/**
 * Unique verifiable-claim categories present in a triage pass, in stable
 * order -- the retrieval fan-out list.
 */
export function uniqueCategories(triage: TriageResult[]): ClaimCategory[] {
  const seen = new Set<ClaimCategory>();
  for (const t of triage) {
    if (t.is_verifiable_claim && t.category) seen.add(t.category);
  }
  return [...seen];
}
