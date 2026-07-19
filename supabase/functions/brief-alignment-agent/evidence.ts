/**
 * evidence.ts — EvidenceBundle validation and prompt-context building for
 * the Brief Alignment Agent.
 */

import type { EvidenceBundle } from "../shared/schemas.ts";

const CAMPAIGN_GOALS = [
  "awareness",
  "consideration",
  "conversion",
  "repurchase",
];

export class InvalidEvidenceBundleError extends Error {}

export function validateEvidenceBundle(body: unknown): EvidenceBundle {
  if (typeof body !== "object" || body === null) {
    throw new InvalidEvidenceBundleError("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.review_id !== "string" || b.review_id.length === 0) {
    throw new InvalidEvidenceBundleError("review_id is required");
  }
  if (typeof b.variant_id !== "string" || b.variant_id.length === 0) {
    throw new InvalidEvidenceBundleError("variant_id is required");
  }
  if (typeof b.creative_brief !== "string") {
    throw new InvalidEvidenceBundleError("creative_brief is required");
  }
  if (
    typeof b.campaign_goal !== "string" ||
    !CAMPAIGN_GOALS.includes(b.campaign_goal)
  ) {
    throw new InvalidEvidenceBundleError(
      `campaign_goal must be one of ${CAMPAIGN_GOALS.join("|")}`,
    );
  }
  if (!Array.isArray(b.transcript_segments)) {
    throw new InvalidEvidenceBundleError(
      "transcript_segments must be an array",
    );
  }
  if (!Array.isArray(b.ocr_segments)) {
    throw new InvalidEvidenceBundleError("ocr_segments must be an array");
  }
  if (!Array.isArray(b.scene_segments)) {
    throw new InvalidEvidenceBundleError("scene_segments must be an array");
  }

  return b as unknown as EvidenceBundle;
}

export function buildUserContent(bundle: EvidenceBundle): string {
  const transcript = bundle.transcript_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const ocr = bundle.ocr_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const scenes = bundle.scene_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.visual_description}`)
    .join("\n");

  return [
    `CREATIVE BRIEF:\n${bundle.creative_brief}`,
    `CAMPAIGN GOAL: ${bundle.campaign_goal}`,
    `TRANSCRIPT:\n${transcript || "(none)"}`,
    `ON-SCREEN TEXT (OCR):\n${ocr || "(none)"}`,
    `SCENE DESCRIPTIONS:\n${scenes || "(none)"}`,
  ].join("\n\n");
}
