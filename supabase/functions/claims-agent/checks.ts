/**
 * checks.ts — Claim-pipeline data types and the three LLM-backed checks:
 *    - extraction (detect + dedupe claims)
 *    - triage (real claim vs. puffery)
 *    - substantiation (product truth, folding in regulatory substantiation standards).
 *    - Ad-wide policy checks (disclaimer, policy-violation depiction) live in policy.ts
 *
 * Each LLM-backed check is ONE batched call, not one call per claim.
 */

import { z } from "zod";
import { chat, timestampFromMs } from "../shared/index.ts";
import type {
  OCRSegment,
  ParsedCreativeBrief,
  ProductContext,
  TranscriptSegment,
} from "../shared/index.ts";
import {
  buildExtractionUserPrompt,
  buildSubstantiationUserPrompt,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
  SUBSTANTIATION_SYSTEM_PROMPT,
} from "./prompts.ts";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type SeverityScore = 0 | 1 | 2 | 3 | 4;

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

export type ClaimInstance = {
  text: string;
  source: "transcript" | "ocr";
  start_ms: number;
  timestamp: string;
};

export type DerivedClaim = {
  claim_id: string;
  text: string;
  instances: ClaimInstance[];
};

export type TriageResult = {
  claim_id: string;
  is_verifiable_claim: boolean;
  category: ClaimCategory | null;
  reasoning: string;
};

export type VerifiableClaim = DerivedClaim & { category: ClaimCategory };

export const SUBSTANTIATION_CLASSIFICATIONS = [
  "unsupported",
  "contradicted",
  "forbidden_claim",
  "none",
] as const;
export type SubstantiationClassification =
  typeof SUBSTANTIATION_CLASSIFICATIONS[number];

export type SubstantiationFinding = {
  claim_id: string;
  classification: SubstantiationClassification;
  severity: SeverityScore;
  issue_description: string;
  recommendation: string;
  product_page_evidence: string;
  confidence_score: number;
};

/* -------------------------------------------------------------------------- */
/* LLM response parsing                                                      */
/* -------------------------------------------------------------------------- */

const SEVERITY_SCORE = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const ExtractionResponseSchema = z.array(z.object({
  claim_id: z.string(),
  text: z.string(),
  segment_ids: z.array(z.string()).min(1),
}));

const TriageResponseSchema = z.array(z.object({
  claim_id: z.string(),
  is_verifiable_claim: z.boolean(),
  category: z.enum(CLAIM_CATEGORIES).nullable(),
  reasoning: z.string(),
}));

const SubstantiationResponseSchema = z.array(z.object({
  claim_id: z.string(),
  classification: z.enum(SUBSTANTIATION_CLASSIFICATIONS),
  severity: SEVERITY_SCORE,
  issue_description: z.string(),
  recommendation: z.string(),
  product_page_evidence: z.string(),
  confidence_score: z.number().min(0).max(1),
}));

function parseLLMJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(
    /```\s*$/i,
    "",
  ).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(
      `${context}: LLM response was not valid JSON (${
        (e as Error).message
      }). Raw response (first 300 chars): ${raw.slice(0, 300)}`,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `${context}: LLM response did not match the expected shape: ${result.error.message}`,
    );
  }
  return result.data;
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

export function processExtractionResponse(
  raw: string,
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
): DerivedClaim[] {
  const parsed = parseLLMJson(
    raw,
    ExtractionResponseSchema,
    "claims-extraction",
  );

  const segmentLookup = new Map<string, ClaimInstance>();
  for (const seg of transcript) {
    segmentLookup.set(seg.segment_id, {
      text: seg.text,
      source: "transcript",
      start_ms: seg.start_ms,
      timestamp: timestampFromMs(seg.start_ms),
    });
  }
  for (const seg of ocr) {
    segmentLookup.set(seg.ocr_id, {
      text: seg.text,
      source: "ocr",
      start_ms: seg.start_ms,
      timestamp: timestampFromMs(seg.start_ms),
    });
  }

  return parsed
    .map((claim, i): DerivedClaim | null => {
      const instances = [...new Set(claim.segment_ids)]
        .map((id) => segmentLookup.get(id))
        .filter((inst): inst is ClaimInstance => inst !== undefined);
      if (instances.length === 0) return null;
      return {
        claim_id: claim.claim_id || `claim-${i + 1}`,
        text: claim.text,
        instances,
      };
    })
    .filter((c): c is DerivedClaim => c !== null);
}

export async function extractClaims(
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
): Promise<DerivedClaim[]> {
  if (transcript.length === 0 && ocr.length === 0) return [];
  const raw = await chat([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: buildExtractionUserPrompt(transcript, ocr) },
  ]);
  return processExtractionResponse(raw, transcript, ocr);
}

/* -------------------------------------------------------------------------- */
/* Triage                                                                     */
/* -------------------------------------------------------------------------- */

export function processTriageResponse(
  raw: string,
  claims: DerivedClaim[],
): TriageResult[] {
  const parsed = parseLLMJson(raw, TriageResponseSchema, "claims-triage");
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  return claims.map((claim): TriageResult => {
    const result = byId.get(claim.claim_id);
    if (result) return result;
    return {
      claim_id: claim.claim_id,
      is_verifiable_claim: true,
      category: "factual_claim",
      reasoning:
        "Triage response did not cover this claim; defaulting to verifiable for safety.",
    };
  });
}

export async function triageClaims(
  claims: DerivedClaim[],
  brief: ParsedCreativeBrief,
): Promise<TriageResult[]> {
  if (claims.length === 0) return [];
  const raw = await chat([
    { role: "system", content: buildTriageSystemPrompt() },
    { role: "user", content: buildTriageUserPrompt(claims, brief) },
  ]);
  return processTriageResponse(raw, claims);
}

/* -------------------------------------------------------------------------- */
/* Substantiation: product truth + regulatory substantiation standard,      */
/* combined -- classifies each claim into one of product_truth's 3 buckets. */
/* -------------------------------------------------------------------------- */

export function processSubstantiationResponse(
  raw: string,
  claims: VerifiableClaim[],
): SubstantiationFinding[] {
  const parsed = parseLLMJson(
    raw,
    SubstantiationResponseSchema,
    "claims-substantiation",
  );
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  return claims.map((claim): SubstantiationFinding => {
    const result = byId.get(claim.claim_id);
    if (result) return result;
    return {
      claim_id: claim.claim_id,
      classification: "unsupported",
      severity: 2,
      issue_description:
        "Substantiation response did not cover this claim; flagged for manual review.",
      recommendation:
        "Review this claim manually against the product page and creative brief.",
      product_page_evidence: "",
      confidence_score: 0.2,
    };
  });
}

export async function substantiateClaims(
  claims: VerifiableClaim[],
  brief: ParsedCreativeBrief,
  productContext: ProductContext | undefined,
): Promise<SubstantiationFinding[]> {
  if (claims.length === 0) return [];
  const raw = await chat([
    { role: "system", content: SUBSTANTIATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildSubstantiationUserPrompt(claims, brief, productContext),
    },
  ]);
  return processSubstantiationResponse(raw, claims);
}
