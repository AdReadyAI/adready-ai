import { createSupabaseServiceClient } from "../shared/index.ts";
import { AgentContextSchema } from "../shared/schemas.ts";
import type { AgentContext, MetricResult } from "../shared/schemas.ts";

function required<T>(value: T | null, name: string): T {
  if (value === null) {
    throw new Error(`${name} was not found for this request/video.`);
  }
  return value;
}

/**
 * Loads the DB-backed context for exactly one creative video. The authenticated
 * owner is checked before using the service-role client for all context joins.
 */
export async function loadBrandContext(
  requestId: string,
  videoId: string,
  userId?: string,
): Promise<AgentContext> {
  if (!userId) {
    throw new Error("Authenticated user is required to load agent context.");
  }

  const supabase = createSupabaseServiceClient();
  const { data: request, error: requestError } = await supabase
    .from("requests")
    .select("request_id, campaign_goal")
    .eq("request_id", requestId)
    .eq("user_id", userId)
    .maybeSingle();
  if (requestError) throw requestError;
  required(request, "Request");

  const { data: video, error: videoError } = await supabase
    .from("request_videos")
    .select("video_id, destination_platform")
    .eq("video_id", videoId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (videoError) throw videoError;
  required(video, "Video");

  const { data: processing, error: processingError } = await supabase
    .from("video_processing")
    .select("id, task_name")
    .eq("video_id", videoId);
  if (processingError) throw processingError;
  const transcriptionId = processing?.find((row) =>
    row.task_name === "transcription"
  )?.id;

  const [
    briefResponse,
    metadataResponse,
    productContextResponse,
    transcriptResponse,
    ocrResponse,
    visualResponse,
    productFramesResponse,
    logoFramesResponse,
  ] = await Promise.all([
    supabase.from("parsed_creative_briefs").select("*").eq(
      "request_id",
      requestId,
    ).maybeSingle(),
    supabase.from("video_metadata").select("*").eq("video_id", videoId)
      .maybeSingle(),
    supabase.from("product_context").select("*").eq("request_id", requestId)
      .maybeSingle(),
    transcriptionId
      ? supabase.from("transcript_segments").select(
        "segment_id, start_ms, end_ms, text, speaker",
      ).eq("processing_id", transcriptionId)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("ocr_segments").select(
      "ocr_id, frame_ids, start_ms, end_ms, text, on_screen_duration_ms, region_size, font_size_px",
    ).eq("video_id", videoId),
    supabase.from("visual_frames").select(
      "frame_id, timestamp_ms, image_url, visual_description, people, color_palette, background, camera_movement, technical_flags",
    ).eq("video_id", videoId),
    supabase.from("product_frames").select(
      "frame_id, timestamp_ms, location, confidence_score, prominence, focus_quality, framing, usage_context",
    ).eq("video_id", videoId),
    supabase.from("logo_frames").select(
      "frame_id, timestamp_ms, location, confidence_score, prominence, reference_match",
    ).eq("video_id", videoId),
  ]);

  for (
    const response of [
      briefResponse,
      metadataResponse,
      productContextResponse,
      transcriptResponse,
      ocrResponse,
      visualResponse,
      productFramesResponse,
      logoFramesResponse,
    ]
  ) {
    if (response.error) throw response.error;
  }

  return AgentContextSchema.parse({
    request_id: requestId,
    video_id: videoId,
    campaign_goal: required(request, "Request").campaign_goal ?? "unknown",
    destination_platform: required(video, "Video").destination_platform,
    parsed_creative_brief: required(
      briefResponse.data,
      "Parsed creative brief",
    ),
    video_metadata: required(metadataResponse.data, "Video metadata"),
    transcript_segments: transcriptResponse.data ?? [],
    ocr_segments: ocrResponse.data ?? [],
    visual_frames: visualResponse.data ?? [],
    product_frames: productFramesResponse.data ?? [],
    logo_frames: logoFramesResponse.data ?? [],
    product_context: productContextResponse.data ?? undefined,
  });
}

/** Stores the current MetricResult[] bundle for one request video. */
export async function persistBrandResult(
  requestId: string,
  videoId: string,
  result: MetricResult,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("agent_results").upsert({
    request_id: requestId,
    video_id: videoId,
    results: [result],
  }, { onConflict: "request_id,video_id" });
  if (error) throw error;
}
