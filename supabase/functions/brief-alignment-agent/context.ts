/**
 * context.ts — DB-backed AgentContext loader for the Brief Alignment agent.
 *
 * Orchestration invokes the agent with a request_id; this module loads the
 * working context from the migrations-backed tables (requests, parsed briefs,
 * transcript, OCR, visual frames, etc.) and validates it with AgentContextSchema.
 */

import { createSupabaseServiceClient } from "../shared/index.ts";
import { type AgentContext, AgentContextSchema } from "../shared/schemas.ts";

function notFound(message: string): never {
  throw new Response(
    JSON.stringify({
      ok: false,
      error: { code: "NOT_FOUND", message },
    }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

function badContext(message: string): never {
  throw new Response(
    JSON.stringify({
      ok: false,
      error: { code: "INVALID_CONTEXT", message },
    }),
    { status: 422, headers: { "Content-Type": "application/json" } },
  );
}

export async function loadAgentContext(
  requestId: string,
): Promise<AgentContext> {
  const supabase = createSupabaseServiceClient();

  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("request_id, campaign_goal")
    .eq("request_id", requestId)
    .maybeSingle();

  if (requestError) {
    throw new Error(`failed to load request: ${requestError.message}`);
  }
  if (!request) notFound(`request ${requestId} not found`);
  if (!request.campaign_goal) {
    badContext(`request ${requestId} is missing campaign_goal`);
  }

  const { data: brief, error: briefError } = await supabase
    .from("parsed_creative_briefs")
    .select(
      "raw_text, destination_platform, brand_voice, target_audience, required_messages, required_ctas, approved_claims, forbidden_claims, brand_guidelines, policy_requirements",
    )
    .eq("request_id", requestId)
    .maybeSingle();

  if (briefError) {
    throw new Error(
      `failed to load parsed creative brief: ${briefError.message}`,
    );
  }
  if (!brief) notFound(`parsed creative brief for ${requestId} not found`);

  const { data: metadata, error: metadataError } = await supabase
    .from("video_metadata")
    .select(
      "duration_ms, aspect_ratio, resolution, dropped_frame_markers, corruption_detected",
    )
    .eq("request_id", requestId)
    .maybeSingle();

  if (metadataError) {
    throw new Error(`failed to load video metadata: ${metadataError.message}`);
  }
  if (!metadata) notFound(`video metadata for ${requestId} not found`);

  const { data: processing, error: processingError } = await supabase
    .from("video_processing")
    .select("id")
    .eq("request_id", requestId)
    .eq("task_name", "transcription")
    .eq("status", "success")
    .maybeSingle();

  if (processingError) {
    throw new Error(
      `failed to load transcription processing row: ${processingError.message}`,
    );
  }

  let transcript_segments: unknown[] = [];
  if (processing?.id) {
    const { data: transcript, error: transcriptError } = await supabase
      .from("transcript_segments")
      .select("segment_id, start_ms, end_ms, text, speaker")
      .eq("processing_id", processing.id)
      .order("start_ms", { ascending: true });

    if (transcriptError) {
      throw new Error(
        `failed to load transcript segments: ${transcriptError.message}`,
      );
    }
    transcript_segments = transcript ?? [];
  }

  const [
    { data: ocr, error: ocrError },
    { data: visual, error: visualError },
    { data: productFrames, error: productFramesError },
    { data: logo, error: logoError },
    { data: productContext, error: productContextError },
  ] = await Promise.all([
    supabase
      .from("ocr_segments")
      .select(
        "ocr_id, frame_ids, start_ms, end_ms, text, on_screen_duration_ms, region_size, font_size_px",
      )
      .eq("request_id", requestId)
      .order("start_ms", { ascending: true }),
    supabase
      .from("visual_frames")
      .select(
        "frame_id, timestamp_ms, image_url, visual_description, people, color_palette, background, camera_movement, technical_flags",
      )
      .eq("request_id", requestId)
      .order("timestamp_ms", { ascending: true }),
    supabase
      .from("product_frames")
      .select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, focus_quality, framing, usage_context",
      )
      .eq("request_id", requestId)
      .order("timestamp_ms", { ascending: true }),
    supabase
      .from("logo_frames")
      .select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, reference_match",
      )
      .eq("request_id", requestId)
      .order("timestamp_ms", { ascending: true }),
    supabase
      .from("product_context")
      .select("raw_text, claims, contraindications, reference_asset_urls")
      .eq("request_id", requestId)
      .maybeSingle(),
  ]);

  if (ocrError) {
    throw new Error(`failed to load OCR segments: ${ocrError.message}`);
  }
  if (visualError) {
    throw new Error(`failed to load visual frames: ${visualError.message}`);
  }
  if (productFramesError) {
    throw new Error(
      `failed to load product frames: ${productFramesError.message}`,
    );
  }
  if (logoError) {
    throw new Error(`failed to load logo frames: ${logoError.message}`);
  }
  if (productContextError) {
    throw new Error(
      `failed to load product context: ${productContextError.message}`,
    );
  }

  const parsed = AgentContextSchema.safeParse({
    request_id: request.request_id,
    campaign_goal: request.campaign_goal,
    destination_platform: brief.destination_platform,
    parsed_creative_brief: {
      raw_text: brief.raw_text,
      brand_voice: brief.brand_voice ?? undefined,
      target_audience: brief.target_audience ?? undefined,
      required_messages: brief.required_messages ?? [],
      required_ctas: brief.required_ctas ?? [],
      approved_claims: brief.approved_claims ?? [],
      forbidden_claims: brief.forbidden_claims ?? [],
      brand_guidelines: brief.brand_guidelines ?? [],
      policy_requirements: brief.policy_requirements ?? [],
    },
    video_metadata: {
      duration_ms: metadata.duration_ms,
      aspect_ratio: metadata.aspect_ratio,
      resolution: metadata.resolution,
      dropped_frame_markers: metadata.dropped_frame_markers ?? [],
      corruption_detected: metadata.corruption_detected ?? undefined,
    },
    transcript_segments,
    ocr_segments: ocr ?? [],
    visual_frames: visual ?? [],
    product_frames: productFrames ?? [],
    logo_frames: logo ?? [],
    product_context: productContext
      ? {
        raw_text: productContext.raw_text ?? undefined,
        claims: productContext.claims ?? [],
        contraindications: productContext.contraindications ?? [],
        reference_asset_urls: productContext.reference_asset_urls ?? [],
      }
      : undefined,
  });

  if (!parsed.success) {
    badContext(
      `AgentContext validation failed: ${
        parsed.error.issues.map((i) => i.message).join("; ")
      }`,
    );
  }

  return parsed.data;
}
