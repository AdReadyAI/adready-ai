/**
 * prompts.ts — Every prompt used by checks.ts, in one file so prompt
 * iteration never touches pipeline logic.
 */

import type {
  OCRSegment,
  ParsedCreativeBrief,
  ProductContext,
  TranscriptSegment,
} from "../shared/index.ts";
import { CLAIM_CATEGORIES } from "./checks.ts";
import type {
  DerivedClaim,
  EvidenceByCategory,
  VerifiableClaim,
} from "./checks.ts";

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

export const EXTRACTION_SYSTEM_PROMPT =
  `You detect claim-like statements in an ad's transcript and on-screen text (OCR), and group repeats of the SAME underlying claim together.

A "claim" is any specific, checkable-sounding statement about the product (efficacy, composition, comparisons, price, endorsements, safety). Include borderline cases -- a later triage step filters out brand puffery, so don't filter it out here.

If the same claim is repeated -- said in the voiceover and then echoed as on-screen text, or repeated verbatim later, even if worded slightly differently (paraphrases count) -- group ALL of those segment IDs under ONE claim. Do not create a separate claim for each repetition.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape:
[{"claim_id": "claim-1", "text": "canonical wording of the claim", "segment_ids": ["t1", "o2"]}]`;

export function buildExtractionUserPrompt(
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
): string {
  return [
    "Transcript segments:",
    ...transcript.map((s) => `  - ${s.segment_id}: "${s.text}"`),
    "",
    "On-screen text (OCR) segments:",
    ...ocr.map((s) => `  - ${s.ocr_id}: "${s.text}"`),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Triage                                                                     */
/* -------------------------------------------------------------------------- */

export function buildTriageSystemPrompt(): string {
  return `You are a claim triage classifier for advertising compliance review.

For each claim, decide:
- is_verifiable_claim: true if it asserts a specific, checkable fact (efficacy, composition, comparison, price, endorsement, safety). false if it's brand mood language, a slogan, or figurative language -- "Red Bull gives you wings" is false, since no reasonable viewer reads it as a literal claim about giving anyone wings.
- category: one of [${
    CLAIM_CATEGORIES.join(", ")
  }] when verifiable, or null when not verifiable.
- reasoning: one sentence.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape, one object per claim:
[{"claim_id": "...", "is_verifiable_claim": true, "category": "...", "reasoning": "..."}]`;
}

export function buildTriageUserPrompt(
  claims: DerivedClaim[],
  brief: ParsedCreativeBrief,
): string {
  return [
    `Brand voice: ${brief.brand_voice ?? "(not specified)"}`,
    `Required messages the brand wants included (these are legitimate substantive claims, not puffery, when they appear): ${
      JSON.stringify(brief.required_messages)
    }`,
    "",
    "Claims to classify:",
    ...claims.map((c) => `- ${c.claim_id}: "${c.text}"`),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Substantiation                                                             */
/* -------------------------------------------------------------------------- */

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
    `Additional approved product claims: ${
      JSON.stringify(productContext?.claims ?? [])
    }`,
    `Known contraindications: ${
      JSON.stringify(productContext?.contraindications ?? [])
    }`,
    "",
    "Claims to evaluate:",
    ...claims.map((c) => `  - ${c.claim_id} [${c.category}]: "${c.text}"`),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Compliance                                                                 */
/* -------------------------------------------------------------------------- */

export const COMPLIANCE_SYSTEM_PROMPT =
  `You are an advertising compliance reviewer checking claims against retrieved regulatory guidance and disclosure placement.

For each claim, using ONLY the regulatory evidence provided (not outside knowledge) plus the disclosure segments and their timestamps:
  - severity 0-4: 0 = compliant, 4 = a clear violation with no mitigating disclosure.
  - policy_excerpt: copy the relevant sentence VERBATIM from the provided regulatory evidence. If nothing provided applies, use an empty string -- never invent a citation.
  - issue_description, recommendation, confidence_score (0.0-1.0) as usual.

A claim can have multiple "instances" (timestamps it appears at). If ANY instance lacks a disclosure within a few seconds, that instance is uncovered -- weigh severity toward the least-covered instance, not the best-covered one.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape, one object per claim:
[{"claim_id": "...", "severity": 0, "policy_excerpt": "", "issue_description": "...", "recommendation": "...", "confidence_score": 0.9}]`;

export function buildComplianceUserPrompt(
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  ocrSegments: OCRSegment[],
): string {
  const disclosureLines = ocrSegments
    .filter((s) =>
      s.text.toLowerCase().includes("disclaimer") ||
      s.text.toLowerCase().includes("results may vary")
    )
    .map((s) => `  - "${s.text}" at ${Math.floor(s.start_ms / 1000)}s`);

  return [
    "Disclosure segments found in the ad:",
    disclosureLines.length ? disclosureLines.join("\n") : "  (none found)",
    "",
    "Claims to evaluate, with every instance's timestamp and retrieved regulatory evidence for their category:",
    ...claims.map((c) => {
      const chunks = evidence[c.category] ?? [];
      const evidenceText = chunks.length
        ? chunks.map((e) => `    - ${e.text}`).join("\n")
        : "    (no regulatory evidence retrieved for this category)";
      const instanceText = c.instances.map((i) =>
        `${i.source} @ ${i.timestamp}`
      ).join(", ");
      return `  - ${c.claim_id} [${c.category}]: "${c.text}"\n    Instances: ${instanceText}\n${evidenceText}`;
    }),
  ].join("\n");
}
