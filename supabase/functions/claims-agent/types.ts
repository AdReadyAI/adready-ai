/**
 * types.ts — Internal types for the Claims Accuracy Agent pipeline, plus the
 * "port" signatures that separate business logic from implementation.
 *
 * Every judgment stage (triage, substantiation, compliance) is BATCHED: one
 * call handles every claim in the ad, not one call per claim. Each mock
 * implementation and its real counterpart share the exact same signature,
 * so swapping mock -> real later is a one-line import change in index.ts —
 * nothing in metrics/ or index.ts's wiring logic needs to know which one is
 * in use.
 */

import type {
  AgentContext,
  OCRSegment,
  ParsedCreativeBrief,
  ProductContext,
  TranscriptSegment,
} from "../shared/schemas.ts";

/* -------------------------------------------------------------------------- */
/* Pipeline data types                                                       */
/* -------------------------------------------------------------------------- */

export const CLAIM_CATEGORIES = [
  "factual_claim",
  "health_or_medical_claim",
  "comparative_or_superlative_claim",
  "sustainability_or_environmental_claim",
  "pricing_or_offer_claim",
  "endorsement_or_testimonial_claim",
  "safety_claim",
] as const;
export type ClaimCategory = typeof CLAIM_CATEGORIES[number];

/** One occurrence of a claim at a specific point in the ad. */
export type ClaimInstance = {
  text: string;
  source: "transcript" | "ocr";
  start_ms: number;
  timestamp: string;
};

/**
 * A single underlying claim, which may occur more than once in the ad (said
 * in the voiceover, then echoed as on-screen text later, etc.) — every
 * occurrence is tracked in `instances`, but the claim itself is triaged,
 * substantiated, and compliance-checked exactly once, not once per
 * repetition.
 */
export type DerivedClaim = {
  claim_id: string;
  text: string; // canonical wording, representative of all instances
  instances: ClaimInstance[]; // always at least 1
};

/** Triage's verdict on one claim: real & checkable, or puffery. */
export type TriageResult = {
  claim_id: string;
  is_verifiable_claim: boolean;
  category: ClaimCategory | null;
  reasoning: string;
};

/** A claim triage marked verifiable, carried forward with its category attached. */
export type VerifiableClaim = DerivedClaim & { category: ClaimCategory };

/** 0 = no issue, 4 = severe issue. Matches the design doc's severity scale. */
export type SeverityScore = 0 | 1 | 2 | 3 | 4;

export type EvidenceChunk = {
  chunk_id: string;
  source: string;
  text: string;
};

/** Evidence chunks grouped by category, for the categories present in this ad. */
export type EvidenceByCategory = Partial<
  Record<ClaimCategory, EvidenceChunk[]>
>;

export type SubstantiationFinding = {
  claim_id: string;
  severity: SeverityScore;
  issue_description: string;
  recommendation: string;
  confidence_score: number; // 0.0-1.0
};

export type ComplianceFinding = {
  claim_id: string;
  severity: SeverityScore;
  policy_excerpt: string; // "" when there's nothing to cite
  issue_description: string;
  recommendation: string;
  confidence_score: number; // 0.0-1.0
  /** Set by verifyPolicyExcerpts(), not by the compliance agent itself. */
  excerpt_verified: boolean;
};



/** PORT: loads all DB-backed context needed to run this agent, keyed by request_id. */
export type AgentContextProvider = (
  request_id: string,
) => Promise<AgentContext>;

/** PORT: turns raw transcript + OCR text into discrete claim candidates. */
export type ClaimCandidateExtractor = (
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
) => Promise<DerivedClaim[]>;

/**
 * PORT: classifies EVERY candidate claim in one batched call — real claim vs
 * puffery, plus category. Not called once per claim.
 */
export type ClaimTriageAgent = (
  claims: DerivedClaim[],
  brief: ParsedCreativeBrief,
) => Promise<TriageResult[]>;

/**
 * PORT: retrieves evidence for one category from one store. Called once per
 * UNIQUE category present in the ad (see uniqueCategories() in utils.ts) —
 * claims that share a category share retrieval results, instead of each
 * claim triggering its own retrieval pass.
 */
export type EvidenceRetriever = (
  category: ClaimCategory,
  store: "product" | "regulatory",
) => Promise<EvidenceChunk[]>;

/** PORT: judges every verifiable claim's Product Truth support in one batched call. */
export type ClaimSubstantiationAgent = (
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  brief: ParsedCreativeBrief,
  productContext: ProductContext | undefined,
) => Promise<SubstantiationFinding[]>;

/** PORT: judges every verifiable claim's Policy/Compliance readiness in one batched call. */
export type ComplianceCheckAgent = (
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  ocrSegments: OCRSegment[],
  brief: ParsedCreativeBrief,
) => Promise<ComplianceFinding[]>;
