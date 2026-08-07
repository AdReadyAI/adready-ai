/**
 * prompts.ts — Every prompt used by checks.ts / policy.ts.
 */

import type {
  OCRSegment,
  ParsedCreativeBrief,
  ProductContext,
  TranscriptSegment,
} from "../shared/index.ts";
import { CLAIM_CATEGORIES } from "./checks.ts";
import type { DerivedClaim, VerifiableClaim } from "./checks.ts";

/* -------------------------------------------------------------------------- */
/* Extraction                                                                 */
/* -------------------------------------------------------------------------- */

export const EXTRACTION_SYSTEM_PROMPT =
  `You detect claim-like statements in an ad's transcript and on-screen text (OCR), and group repeats of the SAME underlying claim together.

A "claim" is any specific, checkable-sounding statement about the product (efficacy, composition, comparisons, price, endorsements, safety). Include borderline cases -- a later triage step filters out brand puffery, so don't filter it out here.

If the same claim is repeated -- said in the voiceover and then echoed as on-screen text, or repeated verbatim later, even if worded slightly differently (paraphrases count) -- group ALL of those segment IDs under ONE claim. Do not create a separate claim for each repetition. Two DIFFERENT claims made close together in time (e.g. an ingredient claim and a separate serving-suggestion claim) are still two separate claims, even if they appear in the same sentence.

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
/* Substantiation -- product truth + regulatory substantiation, combined     */
/* -------------------------------------------------------------------------- */

export const REGULATORY_KNOWLEDGE_BASE = `
FTC ENDORSEMENT & TESTIMONIAL GUIDES (16 CFR Part 255)
Applies to: endorsement/testimonial claims, any product category.
- Endorsements must reflect the endorser's honest opinion and genuine experience.
- Any material connection between an endorser and the advertiser (payment, free product,
  employment, affiliate relationship) must be clearly and conspicuously disclosed.
- An endorser's statement implying a specific result requires the advertiser to have
  adequate substantiation for that implied claim.

FTC GREEN GUIDES (environmental marketing claims, 16 CFR Part 260)
Applies to: sustainability/environmental claims, any product category.
- General claims like "eco-friendly" or "sustainable" without qualification are disfavored.
- Specific claims (recyclable, compostable, non-toxic, carbon neutral) must be substantiated
  with competent and reliable evidence and must not overstate the benefit.
- Qualifications and disclosures must be clear, prominent, and not undercut by other elements.

FTC HEALTH PRODUCTS COMPLIANCE GUIDANCE (Dec 2022)
Applies to: health or medical claims, across foods, dietary supplements, cosmetics, devices.
- Any health-related claim (efficacy, structure/function, "clinically proven," disease
  treatment/prevention) requires "competent and reliable scientific evidence" -- generally
  meaning evidence comparable in rigor to a randomized controlled trial, not an informal or
  internal consumer survey.
- Marketers may not imply FDA approval/review of a claim or product where none occurred.
- A disclaimer that a claim "has not been evaluated by the FDA" does not cure an otherwise
  unsubstantiated or deceptive health claim.

FDA GUIDANCE: SUBSTANTIATION FOR DIETARY SUPPLEMENT CLAIMS (FD&C Act Section 403(r)(6))
Applies to: structure/function, nutrient deficiency, and general well-being claims for
dietary supplements specifically.
- Manufacturers must possess adequate substantiation for each reasonable interpretation a
  consumer could draw from the claim, not just the narrowest literal reading.
- A claim implying disease treatment, cure, or prevention pushes toward being treated as an
  unapproved drug claim, carrying a substantially higher evidentiary bar.

FTC GENERAL ADVERTISING SUBSTANTIATION DOCTRINE
Applies to: comparative, superlative, and factual claims generally, any product category.
- Any objective claim a reasonable consumer would read as measurable or comparative must be
  substantiated with evidence appropriate to the specific claim before it is disseminated.
- Puffery (subjective, non-measurable statements) is not held to this standard -- but a claim
  that sounds subjective while implying a specific, checkable fact is not puffery.
`.trim();

export const SUBSTANTIATION_SYSTEM_PROMPT =
  `You are a product-claims fact-checker for advertising compliance review.

For each claim, judge whether it is supported by the provided product page, product context, and creative brief, AND whether it meets the regulatory substantiation standard for its type using the frameworks below.

${REGULATORY_KNOWLEDGE_BASE}

For each claim, classify it into exactly one of:
  - "forbidden_claim": the claim matches (verbatim or in substance/paraphrase) an entry in the brief's forbidden_claims list. This takes priority over the other classifications if it applies.
  - "contradicted": the claim directly conflicts with the product page, product context, or a regulatory framework above (e.g. asserts a clinical trial took place when none was conducted).
  - "unsupported": the claim is not directly contradicted, but lacks adequate evidence -- exaggerated, imprecise, or missing the "competent and reliable scientific evidence" the applicable framework requires.
  - "none": the claim is adequately supported. Use severity 0 for this classification.

Score severity 0-4 (0 = no issue, 4 = severe -- directly contradicted with no mitigating disclosure).

product_page_evidence: quote or closely paraphrase the SPECIFIC product page / product context text you are comparing against. Use "" if no specific product-page text applies (e.g. a purely regulatory-framework issue with no product-page angle).

confidence_score is your own confidence in this judgment, 0.0-1.0.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape, one object per claim:
[{"claim_id": "...", "classification": "none", "severity": 0, "issue_description": "...", "recommendation": "...", "product_page_evidence": "...", "confidence_score": 0.9}]`;

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
/* Ad-wide policy: disclaimer presence/adequacy + policy-violation depiction */
/* -------------------------------------------------------------------------- */

export const AD_WIDE_POLICY_SYSTEM_PROMPT =
  `You are an advertising compliance reviewer assessing an entire ad (not an individual claim) for two things:

1. DISCLAIMER: Using the creative brief's policy_requirements and the frameworks below, determine whether this ad requires a disclaimer/warning, and if so, whether an adequate one is actually present anywhere in the transcript or on-screen text. Judge this semantically -- a disclaimer can be phrased many ways ("individual results may vary," "consult your doctor," "see terms for details") and does not need to contain any specific keyword. If you find a matching disclaimer, report the exact segment_id (transcript) or ocr_id (on-screen) it appears in, and set matched_source to the literal string "transcript" or "ocr" (not "on_screen") depending on which one. Do not restate its text yourself.
2. POLICY DEPICTION: Scan the transcript and on-screen text for anything depicting illegal substances, safety hazards, or copyright/trademark infringement (recognizable copyrighted characters, logos, or media). If found, report the exact segment_id (transcript) or ocr_id (on-screen) where it occurs, and set matched_source to the literal string "transcript" or "ocr" (not "on_screen"). Do not restate the text yourself beyond a short description of the concern.
${REGULATORY_KNOWLEDGE_BASE}

Respond with ONLY a JSON object, no markdown fences, no prose before or after. Exact shape:
{"disclaimer": {"required": true, "present": false, "matched_segment_id": null, "matched_source": null, "explanation": "...", "confidence_score": 0.9}, "policy_depiction": {"detected": false, "severity": 0, "description": "...", "matched_segment_id": null, "matched_source": null, "confidence_score": 0.9}}`;

export function buildAdWidePolicyUserPrompt(
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
  brief: ParsedCreativeBrief,
): string {
  return [
    `Brief policy requirements: ${JSON.stringify(brief.policy_requirements)}`,
    "",
    "Transcript segments:",
    ...transcript.map((s) => `  - ${s.segment_id}: "${s.text}"`),
    "",
    "On-screen text (OCR) segments:",
    ...ocr.map((s) => `  - ${s.ocr_id}: "${s.text}"`),
  ].join("\n");
}
