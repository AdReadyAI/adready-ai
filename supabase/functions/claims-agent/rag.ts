/**
 * rag.ts — Regulatory evidence retrieval for compliance checks.
 *
 * Product grounding no longer goes through RAG -- it comes directly from
 * AgentContext.product_context (DB-loaded), passed straight into
 * substantiateClaims(). See agent.ts / checks.ts.
 *
 * Regulatory evidence is retrieved via pgvector similarity search against
 * a `regulatory_chunks` table (not yet ingested -- see note below), keyed
 * by category via Supabase's built-in Edge Runtime embedding model
 * (gte-small, 384-dim, local inference -- not a billed external API call).
 * Retrieval is fanned out by UNIQUE category present in the ad (see
 * uniqueCategories()), not per-claim; agent.ts is expected to call
 * retrieveEvidence() concurrently across categories (Promise.all), not in
 * a sequential loop.
 *
 * The embedding session is created once at module load (not lazily on
 * first request) so the model's cold load happens during function
 * instance startup rather than stealing wall-clock time from the first
 * real request.
 *
 * INGESTION PIPELINE DOES NOT EXIST YET. The `regulatory_chunks` table may
 * not be migrated in every environment, and even where it exists it will
 * return zero rows until a real corpus is ingested. retrieveEvidence()
 * treats every failure mode (RPC missing, query error, embedding timeout,
 * or zero rows) identically: fall back to FALLBACK_REGULATORY_EVIDENCE so
 * compliance checks always have something to validate claims against
 * rather than running on empty evidence. Remove the fallback once the
 * real corpus is ingested and retrieval is verified to return real
 * matches.
 */

import { createSupabaseServiceClient } from "../shared/index.ts";
import type { ClaimCategory, EvidenceChunk, TriageResult } from "./checks.ts";

const EMBEDDING_MODEL = "gte-small";
const MATCH_COUNT = 5;

/**
 * Per-category retrieval must finish within this window (embedding +
 * vector search combined) or the caller falls back to hardcoded
 * guidance -- this does NOT bound the one-time model load, which happens
 * eagerly at module init below, outside any single request's budget.
 */
const RETRIEVAL_TIMEOUT_MS = 15_000;

/**
 * Basic hand-authored fallback regulatory guidance, used only when the real
 * vector store has nothing for a category (empty/unmigrated table, a
 * failed query, or a retrieval timeout). Keeps compliance checks from
 * running on zero evidence while the ingestion pipeline is being built.
 */
const FALLBACK_REGULATORY_EVIDENCE: Partial<
  Record<ClaimCategory, EvidenceChunk[]>
> = {
  health_or_medical_claim: [
    {
      chunk_id: "fallback-health-1",
      source: "fallback_guidance",
      text:
        'Health and efficacy claims such as "clinically proven" assert that a controlled clinical trial took place and must be supported by evidence comparable in rigor to that claim, not by informal or internal consumer surveys alone.',
    },
  ],
  comparative_or_superlative_claim: [
    {
      chunk_id: "fallback-comparative-1",
      source: "fallback_guidance",
      text:
        "Comparative and superlative claims that a reasonable consumer would read as objective and measurable should be supported by evidence comparable in rigor to the comparison being made.",
    },
  ],
  sustainability_or_environmental_claim: [
    {
      chunk_id: "fallback-sustainability-1",
      source: "fallback_guidance",
      text:
        "Environmental and sustainability claims (e.g. 'eco-friendly', 'carbon neutral') must be substantiated and must not omit material qualifications that would change a reasonable consumer's understanding of the claim.",
    },
  ],
  pricing_or_offer_claim: [
    {
      chunk_id: "fallback-pricing-1",
      source: "fallback_guidance",
      text:
        "Advertised discounts and 'limited time' offers must reflect a genuine former price and a real time limitation, not an inflated reference price or an indefinitely repeated urgency claim.",
    },
  ],
  endorsement_or_testimonial_claim: [
    {
      chunk_id: "fallback-endorsement-1",
      source: "fallback_guidance",
      text:
        "Endorsements and testimonials must reflect the honest opinion of the endorser and disclose any material connection (payment, free product, employment) between the endorser and the brand.",
    },
  ],
  safety_claim: [
    {
      chunk_id: "fallback-safety-1",
      source: "fallback_guidance",
      text:
        "Safety claims (e.g. 'non-toxic', 'hypoallergenic', 'safe for daily use') must be supported by testing appropriate to the claim and must not omit known contraindications.",
    },
  ],
  factual_claim: [],
};

/**
 * Created once at module load so the model's cold load/download happens
 * during function instance startup, not during the first inbound request.
 */
type EmbeddingSessionLike = {
  run: (
    text: string,
    options?: { mean_pool?: boolean; normalize?: boolean },
  ) => Promise<unknown>;
};

type GlobalWithSupabaseAi = typeof globalThis & {
  Supabase?: {
    ai?: {
      Session: new (model: string) => EmbeddingSessionLike;
    };
  };
};

let embeddingSession: EmbeddingSessionLike | null = null;
try {
  const globalWithSupabaseAi = globalThis as GlobalWithSupabaseAi;
  const supabaseAi = globalWithSupabaseAi.Supabase?.ai;
  if (supabaseAi?.Session) {
    embeddingSession = new supabaseAi.Session(EMBEDDING_MODEL);
  }
} catch (e) {
  console.warn(
    "rag: Supabase AI embedding session unavailable; falling back to hardcoded guidance.",
    e,
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
   let timeoutId: ReturnType<typeof setTimeout> | undefined;
   const timeout = new Promise<never>((_, reject) => {
     timeoutId = setTimeout(
       () => reject(new Error(`${label} timed out after ${ms}ms`)),
       ms,
     );
   });
   return Promise.race([promise, timeout])
     .finally(() => {
       if (timeoutId !== undefined) clearTimeout(timeoutId);
     }) as Promise<T>;
}

/**
 * Embeds a single query string via Supabase's built-in Edge Runtime
 * inference model. Local inference, not a billed external call.
 */
async function embedQuery(text: string): Promise<number[]> {
  if (!embeddingSession) {
     throw new Error("Supabase AI embedding session is not available in this runtime.");
   }
  const output = await embeddingSession.run(text, {
    mean_pool: true,
    normalize: true,
  });
  return output as number[];
}

/** The semantic query representing "the rules for this claim category." */
function categoryQueryText(category: ClaimCategory): string {
  return `Advertising regulations and compliance guidance for ${
    category.replace(/_/g, " ")
  } claims.`;
}

async function queryRegulatoryChunks(
  category: ClaimCategory,
  embedding: number[],
): Promise<EvidenceChunk[]> {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase.rpc("match_regulatory_chunks", {
    query_embedding: embedding,
    match_category: category,
    match_count: MATCH_COUNT,
  });

  if (error) {
    // Table/RPC may not exist yet in some environments -- treat as "no
    // evidence found" rather than a hard failure; caller falls back.
    console.error(
      `rag: regulatory vector search failed for category "${category}":`,
      error,
    );
    return [];
  }

  return (data ?? []).map(
    (row: { chunk_id: string; source: string; text: string }) => ({
      chunk_id: row.chunk_id,
      source: row.source,
      text: row.text,
    }),
  );
}

/**
 * Retrieves regulatory evidence for a claim category via pgvector
 * similarity search, falling back to hardcoded basics when the vector
 * store returns nothing, the query fails, or retrieval times out.
 *
 * Bounded to RETRIEVAL_TIMEOUT_MS -- callers should invoke this
 * concurrently across categories (Promise.all), not in a sequential loop,
 * so one slow/stuck category can't multiply the total wait.
 */
export async function retrieveEvidence(
  category: ClaimCategory,
): Promise<EvidenceChunk[]> {
  try {
    const chunks = await withTimeout(
      (async () => {
        const embedding = await embedQuery(categoryQueryText(category));
        return await queryRegulatoryChunks(category, embedding);
      })(),
      RETRIEVAL_TIMEOUT_MS,
      `regulatory retrieval for "${category}"`,
    );
    if (chunks.length > 0) return chunks;
  } catch (e) {
    console.error(`rag: retrieval failed for category "${category}":`, e);
  }

  return FALLBACK_REGULATORY_EVIDENCE[category] ?? [];
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
