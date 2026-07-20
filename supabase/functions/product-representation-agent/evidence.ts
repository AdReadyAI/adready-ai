/**
 * evidence.ts — EvidenceBundle validation, keyframe→scene join, and
 * prompt-context building for the Product Representation Agent.
 *
 * No vision: Keyframe only carries frame_id/timestamp_ms/scene_id/image_url,
 * so each product moment's keyframes are described to the model via the
 * linked scene_segments.visual_description / visual_elements rather than
 * the actual image. Revisit this once Media Processing confirms whether
 * keyframes will carry real descriptions or images become viewable.
 */

import type { EvidenceBundle } from "../shared/schemas.ts";

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
  if (!Array.isArray(b.product_moments)) {
    throw new InvalidEvidenceBundleError("product_moments must be an array");
  }
  if (!Array.isArray(b.keyframes)) {
    throw new InvalidEvidenceBundleError("keyframes must be an array");
  }
  if (!Array.isArray(b.scene_segments)) {
    throw new InvalidEvidenceBundleError("scene_segments must be an array");
  }
  if (!Array.isArray(b.reference_assets)) {
    throw new InvalidEvidenceBundleError("reference_assets must be an array");
  }
  if (!Array.isArray(b.transcript_segments)) {
    throw new InvalidEvidenceBundleError(
      "transcript_segments must be an array",
    );
  }
  if (!Array.isArray(b.ocr_segments)) {
    throw new InvalidEvidenceBundleError("ocr_segments must be an array");
  }
  const videoMetadata = b.video_metadata as Record<string, unknown> | undefined;
  if (!videoMetadata || typeof videoMetadata.duration_ms !== "number") {
    throw new InvalidEvidenceBundleError(
      "video_metadata.duration_ms is required",
    );
  }

  return b as unknown as EvidenceBundle;
}

export type ProductMomentContext = {
  moment_id: string;
  start_ms: number;
  end_ms: number;
  frame_ids: string[];
  scene_descriptions: string[];
};

export function buildProductMomentContexts(
  bundle: EvidenceBundle,
): ProductMomentContext[] {
  const keyframeById = new Map(bundle.keyframes.map((k) => [k.frame_id, k]));
  const sceneById = new Map(bundle.scene_segments.map((s) => [s.scene_id, s]));

  return bundle.product_moments.map((moment) => {
    const descriptions: string[] = [];
    for (const frameId of moment.frame_ids) {
      const keyframe = keyframeById.get(frameId);
      if (!keyframe) continue;
      const scene = sceneById.get(keyframe.scene_id);
      if (!scene) continue;

      const elements = scene.visual_elements;
      const extras = elements
        ? [
          elements.detected_people?.length
            ? `people: ${elements.detected_people.join(", ")}`
            : "",
          elements.dominant_colors?.length
            ? `colors: ${elements.dominant_colors.join(", ")}`
            : "",
          elements.tone_mood ? `mood: ${elements.tone_mood}` : "",
        ].filter(Boolean).join("; ")
        : "";

      descriptions.push(
        extras
          ? `${scene.visual_description} (${extras})`
          : scene.visual_description,
      );
    }

    return {
      moment_id: moment.moment_id,
      start_ms: moment.start_ms,
      end_ms: moment.end_ms,
      frame_ids: moment.frame_ids,
      scene_descriptions: [...new Set(descriptions)],
    };
  });
}

export function buildUserContent(bundle: EvidenceBundle): string {
  const moments = buildProductMomentContexts(bundle);
  const momentsText = moments
    .map((m) =>
      `[moment ${m.moment_id}, ${m.start_ms}-${m.end_ms}ms] ${
        m.scene_descriptions.length
          ? m.scene_descriptions.join(" | ")
          : "(no scene description available for this moment's keyframes)"
      }`
    )
    .join("\n");
  const transcript = bundle.transcript_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const ocr = bundle.ocr_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const referenceAssets = bundle.reference_assets
    .filter((a) => a.type === "product_image")
    .map((a) => `product_image reference: ${a.asset_id}`)
    .join("\n");

  return [
    `CREATIVE BRIEF (contains the product name/packaging description):\n${bundle.creative_brief}`,
    `PRODUCT MOMENTS (time ranges the product is detected on screen, described via linked scene text — no direct image access):\n${
      momentsText || "(no product moments detected)"
    }`,
    `TRANSCRIPT:\n${transcript || "(none)"}`,
    `ON-SCREEN TEXT (OCR):\n${ocr || "(none)"}`,
    `REFERENCE ASSETS AVAILABLE (image URLs only, not viewable by you):\n${
      referenceAssets || "(none)"
    }`,
    `TOTAL VIDEO DURATION: ${bundle.video_metadata.duration_ms}ms`,
  ].join("\n\n");
}
