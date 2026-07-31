/**
 * checks.ts — Every claim-pipeline data type, plus the four checks that
 * turn context into findings: extraction (detect + dedupe claims), triage
 * (real claim vs. puffery), substantiation (product truth), and compliance
 * (policy/regulatory readiness).
 *
 * Each LLM-backed check is ONE batched call across every claim, not one
 * call per claim. Each exports a pure `process*Response()` function
 * (parsing + fallback logic, no network) separately from the thin wrapper
 * that calls chat() -- see checks.test.ts, which tests the pure functions
 * directly with zero mocking.
 *
 * NOTE: shared/checks.ts (exported via ../shared/index.ts) may already
 * provide equivalent JSON-parsing/schema helpers -- this file's local
 * parseLLMJson()/response schemas are NOT that file (different module,
 * this one is claims-agent-local). Built from scratch since the shared
 * version's contents weren't available; worth consolidating if it already
 * covers this.
 */

import { z } from "zod";
import { chat } from "../shared/index.ts";
import type {
  OCRSegment,
  ParsedCreativeBrief,
  ProductContext,
  TranscriptSegment,
} from "../shared/index.ts";
import {
  buildComplianceUserPrompt,
  buildExtractionUserPrompt,
  buildSubstantiationUserPrompt,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  COMPLIANCE_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  SUBSTANTIATION_SYSTEM_PROMPT,
} from "./prompts.ts";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** 0 = no issue, 4 = severe issue. The scale every check scores against. */
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

/** One occurrence of a claim at a specific point in the ad. */
export type ClaimInstance = {
  text: string;
  source: "transcript" | "ocr";
  start_ms: number;
  timestamp: string;
};

/**
 * A single underlying claim, which may occur more than once in the ad --
 * every occurrence is tracked in `instances`, but the claim itself is
 * triaged, substantiated, and compliance-checked exactly once.
 */
export type DerivedClaim = {
  claim_id: string;
  text: string; // canonical wording, representative of all instances
  instances: ClaimInstance[]; // always at least 1
};

export type TriageResult = {
  claim_id: string;
  is_verifiable_claim: boolean;
  category: ClaimCategory | null;
  reasoning: string;
};

export type VerifiableClaim = DerivedClaim & { category: ClaimCategory };

export type EvidenceChunk = { chunk_id: string; source: string; text: string };
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
  excerpt_verified: boolean; // set by verifyPolicyExcerpts(), not by the model
};

/** MM:SS from a millisecond offset. Small enough to keep local rather than share. */
function msToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
}

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
  severity: SEVERITY_SCORE,
  issue_description: z.string(),
  recommendation: z.string(),
  confidence_score: z.number().min(0).max(1),
}));

/** Excludes excerpt_verified -- that's set afterward by verifyPolicyExcerpts(), not by the model. */
const ComplianceResponseSchema = z.array(z.object({
  claim_id: z.string(),
  severity: SEVERITY_SCORE,
  policy_excerpt: z.string(),
  issue_description: z.string(),
  recommendation: z.string(),
  confidence_score: z.number().min(0).max(1),
}));

/**
 * Strips stray markdown fences and validates against a zod schema before
 * any pipeline code trusts an LLM response -- a malformed response fails
 * loudly here instead of silently corrupting downstream findings.
 */
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
/* Extraction: detect claim-like spans + merge repeats into one claim        */
/* -------------------------------------------------------------------------- */

/** Pure: parses/validates the raw response and resolves segment_ids against the real segments. */
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
      timestamp: msToTimestamp(seg.start_ms),
    });
  }
  for (const seg of ocr) {
    segmentLookup.set(seg.ocr_id, {
      text: seg.text,
      source: "ocr",
      start_ms: seg.start_ms,
      timestamp: msToTimestamp(seg.start_ms),
    });
  }

  return parsed
    .map((claim, i): DerivedClaim | null => {
      const instances = claim.segment_ids
        .map((id) => segmentLookup.get(id))
        .filter((inst): inst is ClaimInstance => inst !== undefined);
      if (instances.length === 0) return null; // only unrecognized segment_ids -- drop rather than fabricate
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
/* Triage: real claim vs. puffery, plus category                             */
/* -------------------------------------------------------------------------- */

/** Pure: parses/validates the raw response and applies the missing-claim fallback. */
export function processTriageResponse(
  raw: string,
  claims: DerivedClaim[],
): TriageResult[] {
  const parsed = parseLLMJson(raw, TriageResponseSchema, "claims-triage");
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  return claims.map((claim): TriageResult => {
    const result = byId.get(claim.claim_id);
    if (result) return result;
    // The model didn't cover this claim -- default to verifiable, not
    // puffery. A false negative here skips substantiation/compliance
    // entirely, which is worse than a claim that turns out to be fine.
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
/* Substantiation: Product Truth support                                     */
/* -------------------------------------------------------------------------- */

/** Pure: parses/validates the raw response and applies the missing-claim fallback. */
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
      severity: 2,
      issue_description:
        "Substantiation response did not cover this claim; flagged for manual review.",
      recommendation:
        "Review this claim manually against the product page and creative brief.",
      confidence_score: 0.2,
    };
  });
}

export async function substantiateClaims(
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  brief: ParsedCreativeBrief,
  productContext: ProductContext | undefined,
): Promise<SubstantiationFinding[]> {
  if (claims.length === 0) return [];
  const raw = await chat([
    { role: "system", content: SUBSTANTIATION_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildSubstantiationUserPrompt(
        claims,
        evidence,
        brief,
        productContext,
      ),
    },
  ]);
  return processSubstantiationResponse(raw, claims);
}

/* -------------------------------------------------------------------------- */
/* Compliance: Policy / regulatory readiness                                 */
/* -------------------------------------------------------------------------- */

/** Pure: parses/validates the raw response and applies the missing-claim fallback. */
export function processComplianceResponse(
  raw: string,
  claims: VerifiableClaim[],
): ComplianceFinding[] {
  const parsed = parseLLMJson(
    raw,
    ComplianceResponseSchema,
    "compliance-check",
  );
  const byId = new Map(parsed.map((r) => [r.claim_id, r]));

  return claims.map((claim): ComplianceFinding => {
    const result = byId.get(claim.claim_id);
    if (result) return { ...result, excerpt_verified: false }; // finalized by verifyPolicyExcerpts()
    return {
      claim_id: claim.claim_id,
      severity: 2,
      policy_excerpt: "",
      issue_description:
        "Compliance response did not cover this claim; flagged for manual review.",
      recommendation:
        "Review this claim manually against applicable regulations.",
      confidence_score: 0.2,
      excerpt_verified: false,
    };
  });
}

export async function checkCompliance(
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  ocrSegments: OCRSegment[],
  _brief: ParsedCreativeBrief,
): Promise<ComplianceFinding[]> {
  if (claims.length === 0) return [];
  // NOTE: previously split into two batched calls on a stronger model for
  // health/safety claims -- shared/llm.ts's chat() takes no model override,
  // so that tiering isn't possible anymore. One call, one model, for all
  // verifiable claims.
  const raw = await chat([
    { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildComplianceUserPrompt(claims, evidence, ocrSegments),
    },
  ]);
  return processComplianceResponse(raw, claims);
}

/* -------------------------------------------------------------------------- */
/* Anti-hallucination guard on compliance findings                           */
/* -------------------------------------------------------------------------- */

const UNVERIFIED_CONFIDENCE_CAP = 0.3;

/**
 * Cross-checks every non-empty policy_excerpt against the regulatory
 * evidence actually retrieved for that claim's category. Drops and caps
 * confidence on anything not found verbatim -- the safety net against an
 * invented citation.
 */
export function verifyPolicyExcerpts(
  findings: ComplianceFinding[],
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
): ComplianceFinding[] {
  const categoryByClaimId = new Map<string, ClaimCategory>(
    claims.map((c) => [c.claim_id, c.category]),
  );

  return findings.map((finding) => {
    if (!finding.policy_excerpt) return { ...finding, excerpt_verified: true };

    const category = categoryByClaimId.get(finding.claim_id);
    const chunks = category ? evidence[category] ?? [] : [];
    const excerptLower = finding.policy_excerpt.toLowerCase();
    const verified = chunks.some((chunk) =>
      chunk.text.toLowerCase().includes(excerptLower)
    );

    if (verified) return { ...finding, excerpt_verified: true };
    return {
      ...finding,
      policy_excerpt: "",
      excerpt_verified: false,
      confidence_score: Math.min(
        finding.confidence_score,
        UNVERIFIED_CONFIDENCE_CAP,
      ),
    };
  });
}
