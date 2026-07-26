/**
 * tools/claims-extraction.ts — ClaimCandidateExtractor.
 *
 * Detects claim-like spans across transcript + OCR text AND merges spans
 * that assert the SAME underlying claim into one claim with multiple
 * `instances`, in ONE batched call. See prompts/extraction.ts for the
 * prompt.
 *
 * The model only has to say WHICH segments belong together (by
 * segment_id/ocr_id) -- timestamps and source type are looked up from the
 * original segments afterward, rather than trusting the model to
 * transcribe numeric timestamps correctly.
 */

import { chat } from "../../shared/llm.ts";
import type { OCRSegment, TranscriptSegment } from "../../shared/schemas.ts";
import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
} from "../prompts/extraction.ts";
import type {
  ClaimCandidateExtractor,
  ClaimInstance,
  DerivedClaim,
} from "../types.ts";
import { msToTimestamp } from "../utils.ts";
import { ExtractionResponseSchema, parseLLMJson } from "./llm-response.ts";

const EXTRACTION_MODEL = Deno.env.get("OPENROUTER_MODEL_EXTRACTION") ??
  Deno.env.get("OPENROUTER_MODEL");

/**
 * Pure: parses/validates the raw LLM response and resolves each referenced
 * segment_id against the original segments. No network call, no Deno.env
 * access.
 */
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

  // Look up each referenced segment's real source/start_ms/timestamp --
  // don't trust the model to transcribe those correctly.
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
      // The model referenced only segment_ids we don't recognize -- drop
      // this claim rather than fabricate instance data for it.
      if (instances.length === 0) return null;
      return {
        claim_id: claim.claim_id || `claim-${i + 1}`,
        text: claim.text,
        instances,
      };
    })
    .filter((c): c is DerivedClaim => c !== null);
}

export const deriveClaimCandidates: ClaimCandidateExtractor = async (
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
): Promise<DerivedClaim[]> => {
  if (transcript.length === 0 && ocr.length === 0) return [];

  const raw = await chat(
    [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildExtractionUserPrompt(transcript, ocr) },
    ],
    EXTRACTION_MODEL,
  );

  return processExtractionResponse(raw, transcript, ocr);
};
