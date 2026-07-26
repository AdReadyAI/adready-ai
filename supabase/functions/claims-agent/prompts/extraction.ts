/**
 * prompts/extraction.ts — Prompt for tools/claims-extraction.ts.
 *
 * Detects claim-like spans across transcript + OCR text AND merges spans
 * that assert the SAME underlying claim (paraphrases included) into one
 * claim referencing multiple segment_ids, in ONE batched call.
 */

import type { OCRSegment, TranscriptSegment } from "../../shared/schemas.ts";

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
