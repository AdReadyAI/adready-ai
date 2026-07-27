/**
 * context.ts — DB-backed AgentContext loader for the storyline-clarity agent.
 *
 * The orchestrator (a separate, not-yet-built Edge Function) decides which
 * agents run and invokes each with only a request_id. This is what the agent
 * then calls to load its own working AgentContext from Supabase, joining the
 * request-scoped context tables. It is stateless and read-only.
 *
 * Everything is keyed by request_id: the request row (campaign_goal), the parsed
 * creative brief (which also carries destination_platform), video_metadata, the
 * ocr/visual/product/logo frame tables, product_context, and the transcript
 * (reached via the request's transcription row in video_processing).
 *
 * Auth: when `userId` is given, the request must belong to that user before the
 * service-role client reads the rest. Omit `userId` only for trusted/local use
 * (e.g. the eval harness against a seeded DB).
 */

import { createSupabaseServiceClient } from "../shared/index.ts";
import { AgentContextSchema } from "../shared/schemas.ts";
import type { AgentContext } from "../shared/schemas.ts";

function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${name} was not found for this request.`);
  }
  return value;
}

export type LoadContextOptions = { userId?: string };

/**
 * Load the AgentContext for one request. All context rows are keyed by
 * request_id.
 */
export async function loadStorylineContext(
  requestId: string,
  opts: LoadContextOptions = {},
): Promise<AgentContext> {
  const supabase = createSupabaseServiceClient();

  // Request row (+ ownership check when a user is supplied).
  let requestQuery = supabase
    .from("requests")
    .select("request_id, campaign_goal")
    .eq("request_id", requestId);
  if (opts.userId) requestQuery = requestQuery.eq("user_id", opts.userId);
  const { data: request, error: requestError } = await requestQuery
    .maybeSingle();
  if (requestError) throw requestError;
  required(request, "Request");

  // The transcript is keyed by the request's transcription processing row.
  const { data: processing, error: processingError } = await supabase
    .from("video_processing")
    .select("id, task_name")
    .eq("request_id", requestId);
  if (processingError) throw processingError;
  const transcriptionId = processing?.find((row) =>
    row.task_name === "transcription"
  )?.id;

  const [
    brief,
    metadata,
    productContext,
    transcript,
    ocr,
    visual,
    productFrames,
    logoFrames,
  ] = await Promise.all([
    supabase.from("parsed_creative_briefs").select("*").eq(
      "request_id",
      requestId,
    ).maybeSingle(),
    supabase.from("video_metadata").select("*").eq("request_id", requestId)
      .maybeSingle(),
    supabase.from("product_context").select("*").eq("request_id", requestId)
      .maybeSingle(),
    transcriptionId
      ? supabase
        .from("transcript_segments")
        .select("segment_id, start_ms, end_ms, text, speaker")
        .eq("processing_id", transcriptionId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("ocr_segments")
      .select(
        "ocr_id, frame_ids, start_ms, end_ms, text, on_screen_duration_ms, region_size, font_size_px",
      )
      .eq("request_id", requestId),
    supabase
      .from("visual_frames")
      .select(
        "frame_id, timestamp_ms, image_url, visual_description, people, color_palette, background, camera_movement, technical_flags",
      )
      .eq("request_id", requestId),
    supabase
      .from("product_frames")
      .select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, focus_quality, framing, usage_context",
      )
      .eq("request_id", requestId),
    supabase
      .from("logo_frames")
      .select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, reference_match",
      )
      .eq("request_id", requestId),
  ]);

  for (
    const response of [
      brief,
      metadata,
      productContext,
      transcript,
      ocr,
      visual,
      productFrames,
      logoFrames,
    ]
  ) {
    if (response.error) throw response.error;
  }

  // The brief row carries destination_platform alongside the brief fields;
  // AgentContextSchema strips it back out of parsed_creative_brief.
  const briefRow = required(brief.data, "Parsed creative brief");

  return AgentContextSchema.parse({
    request_id: requestId,
    campaign_goal: required(request, "Request").campaign_goal ?? "unknown",
    destination_platform: briefRow.destination_platform,
    parsed_creative_brief: briefRow,
    video_metadata: required(metadata.data, "Video metadata"),
    transcript_segments: transcript.data ?? [],
    ocr_segments: ocr.data ?? [],
    visual_frames: visual.data ?? [],
    product_frames: productFrames.data ?? [],
    logo_frames: logoFrames.data ?? [],
    product_context: productContext.data ?? undefined,
  });
}
