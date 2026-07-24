/**
 * evidence.ts — Prompt-context building for the Product Representation Agent.
 *
 * Consumes the DB-loaded AgentContext. Product visibility is frame-based: each
 * product_frame is described to the model via the matching visual_frame's
 * visual_description (joined by frame_id) plus the product frame's own prominence
 * / focus / framing attributes — the model never sees the raw image. Request
 * validation is handled by the shared edge handler via AgentRunRequestSchema, and
 * the context shape is validated by the loader, so no bespoke input validation
 * lives here.
 */

import type {
  AgentContext,
  LogoFrame,
  ProductFrame,
  VisualFrame,
} from "../shared/schemas.ts";

function describeProductFrame(
  frame: ProductFrame,
  visual?: VisualFrame,
): string {
  const attrs = [
    frame.prominence ? `prominence: ${frame.prominence}` : "",
    frame.focus_quality ? `focus: ${frame.focus_quality}` : "",
    frame.framing ? `framing: ${frame.framing}` : "",
    frame.usage_context ? `usage: ${frame.usage_context}` : "",
  ].filter(Boolean).join(", ");
  const description = visual?.visual_description ??
    "(no matching visual-frame description)";
  return `[${frame.timestamp_ms}ms${attrs ? ", " + attrs : ""}] ${description}`;
}

function describeLogoFrame(frame: LogoFrame, visual?: VisualFrame): string {
  const attrs = [
    frame.prominence ? `prominence: ${frame.prominence}` : "",
    frame.reference_match ? `reference_match: ${frame.reference_match}` : "",
  ].filter(Boolean).join(", ");
  const description = visual?.visual_description ??
    "(no matching visual-frame description)";
  return `[${frame.timestamp_ms}ms${attrs ? ", " + attrs : ""}] ${description}`;
}

export function buildUserContent(context: AgentContext): string {
  const visualById = new Map(
    context.visual_frames.map((f) => [f.frame_id, f]),
  );

  const productFrames = context.product_frames
    .map((f) => describeProductFrame(f, visualById.get(f.frame_id)))
    .join("\n");
  const logoFrames = context.logo_frames
    .map((f) => describeLogoFrame(f, visualById.get(f.frame_id)))
    .join("\n");
  const transcript = context.transcript_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const ocr = context.ocr_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");

  const product = context.product_context;
  const productContextLines: string[] = [];
  if (product?.raw_text) productContextLines.push(product.raw_text);
  if (product?.claims.length) {
    productContextLines.push(
      `Verified claims: ${product.claims.join("; ")}`,
    );
  }
  if (product?.reference_asset_urls.length) {
    productContextLines.push(
      `Reference assets available (URLs only, not viewable by you): ${product.reference_asset_urls.length}`,
    );
  }

  return [
    `CREATIVE BRIEF (contains the product name/packaging description):\n${
      context.parsed_creative_brief.raw_text || "(none)"
    }`,
    `PRODUCT FRAMES (frames where the product was detected, described via the matching visual frame — no direct image access):\n${
      productFrames || "(no product frames detected)"
    }`,
    `LOGO FRAMES:\n${logoFrames || "(no logo frames detected)"}`,
    `TRANSCRIPT:\n${transcript || "(none)"}`,
    `ON-SCREEN TEXT (OCR):\n${ocr || "(none)"}`,
    `PRODUCT CONTEXT:\n${
      productContextLines.length ? productContextLines.join("\n") : "(none)"
    }`,
    `TOTAL VIDEO DURATION: ${context.video_metadata.duration_ms}ms`,
  ].join("\n\n");
}
