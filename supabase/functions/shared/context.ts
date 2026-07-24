/**
 * context.ts — Shared, DB-backed AgentContext loader.
 *
 * Orchestration invokes an agent with a request_id (+ optionally a video_id); the
 * agent loads its working AgentContext from Supabase by joining the context
 * tables. Every evaluator agent needs the same full AgentContext, so the load is
 * shared here rather than duplicated per agent.
 *
 * Request-scoped rows are keyed by request_id (parsed_creative_briefs,
 * product_context, campaign_goal); everything else is video-scoped by video_id
 * (video_metadata, ocr/visual/product/logo, plus destination_platform and the
 * transcript via the video's transcription processing row).
 *
 * Auth: when `userId` is given, the request must belong to that user before the
 * service-role client reads the rest. Omit `userId` only for trusted/local use
 * (e.g. the eval harness against a seeded DB).
 */

import { createSupabaseServiceClient } from "./index.ts";
import { AgentContextSchema } from "./schemas.ts";
import type { AgentContext } from "./schemas.ts";

function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${name} was not found for this request/video.`);
  }
  return value;
}

export type LoadContextOptions = { userId?: string };

/**
 * Load the AgentContext for one creative video. `videoId` selects the video; when
 * omitted, the request's primary video (lowest `position`) is used.
 */
export async function loadAgentContext(
  requestId: string,
  videoId?: string,
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

  // Resolve the video: explicit id, else the primary request_video.
  const videoQuery = supabase
    .from("request_videos")
    .select("video_id, destination_platform")
    .eq("request_id", requestId);
  const { data: video, error: videoError } =
    await (videoId
      ? videoQuery.eq("video_id", videoId).maybeSingle()
      : videoQuery.order("position", { ascending: true }).limit(1)
        .maybeSingle());
  if (videoError) throw videoError;
  const resolvedVideoId = required(video, "Video").video_id;

  // The transcript is keyed by the video's transcription processing row.
  const { data: processing, error: processingError } = await supabase
    .from("video_processing")
    .select("id, task_name")
    .eq("video_id", resolvedVideoId);
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
    supabase.from("video_metadata").select("*").eq("video_id", resolvedVideoId)
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
      .eq("video_id", resolvedVideoId),
    supabase
      .from("visual_frames")
      .select(
        "frame_id, timestamp_ms, image_url, visual_description, people, color_palette, background, camera_movement, technical_flags",
      )
      .eq("video_id", resolvedVideoId),
    supabase
      .from("product_frames")
      .select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, focus_quality, framing, usage_context",
      )
      .eq("video_id", resolvedVideoId),
    supabase
      .from("logo_frames")
      .select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, reference_match",
      )
      .eq("video_id", resolvedVideoId),
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

  return AgentContextSchema.parse({
    request_id: requestId,
    campaign_goal: required(request, "Request").campaign_goal ?? "unknown",
    destination_platform: required(video, "Video").destination_platform,
    parsed_creative_brief: required(brief.data, "Parsed creative brief"),
    video_metadata: required(metadata.data, "Video metadata"),
    transcript_segments: transcript.data ?? [],
    ocr_segments: ocr.data ?? [],
    visual_frames: visual.data ?? [],
    product_frames: productFrames.data ?? [],
    logo_frames: logoFrames.data ?? [],
    product_context: productContext.data ?? undefined,
  });
}
