/**
 * Shared, request-scoped input loader for every evaluation agent.
 *
 * Evaluation agents are invoked through the internal-authenticated handler, so
 * they do not have an end-user identity to scope service-role reads with. A
 * user ID remains optional for a future user-facing rerun path.
 */
import { createSupabaseServiceClient } from "./clients.ts";
import { AgentContextSchema } from "./schemas.ts";
import type { AgentContext } from "./schemas.ts";

export type LoadAgentContextOptions = {
  userId?: string;
};

function required<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${name} was not found for this request.`);
  }
  return value;
}

/**
 * Loads and validates the common DB-backed input for one agent invocation.
 *
 * Agent-specific logic belongs in the calling agent. This function reads the
 * common source tables after the caller has passed internal authentication, or
 * optionally scopes the request to a user for a future user-facing rerun path.
 * It returns the canonical `AgentContext` after runtime validation.
 */
export async function loadAgentContext(
  requestId: string,
  { userId }: LoadAgentContextOptions = {},
): Promise<AgentContext> {
  const supabase = createSupabaseServiceClient();
  let requestQuery = supabase
    .from("requests")
    .select("request_id, batch_id, campaign_goal")
    .eq("request_id", requestId);

  // User-facing reruns must still prove ownership before service-role reads.
  if (userId) {
    requestQuery = requestQuery.eq("user_id", userId);
  }

  const { data: request, error: requestError } = await requestQuery
    .maybeSingle();
  if (requestError) throw requestError;
  const requestRecord = required(request, "Request");

  const { data: processing, error: processingError } = await supabase
    .from("video_processing")
    .select("id, task_name")
    .eq("request_id", requestId);
  if (processingError) throw processingError;
  const transcriptionId = processing?.find((row) =>
    row.task_name === "transcription"
  )?.id;
  const contextId = processing?.find((row) => row.task_name === "context")?.id;
  const productDetectionId = processing?.find((row) =>
    row.task_name === "product_detection"
  )?.id;
  const logoDetectionId = processing?.find((row) =>
    row.task_name === "logo_detection"
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
    qualityFramesResponse,
  ] = await Promise.all([
    requestRecord.batch_id
      ? supabase.from("parsed_creative_briefs").select("*").eq(
        "batch_id",
        requestRecord.batch_id,
      ).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("video_metadata").select("*").eq("request_id", requestId)
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
    ).eq("request_id", requestId),
    contextId
      ? supabase.from("visual_frames").select(
        "frame_id, timestamp_ms, image_url, action, framing_composition, people, color_palette, background, technical_flags, shot_index, is_shot_start, is_fade",
      ).eq("processing_id", contextId)
      : Promise.resolve({ data: [], error: null }),
    productDetectionId
      ? supabase.from("product_frames").select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, focus_quality, framing",
      ).eq("processing_id", productDetectionId)
      : Promise.resolve({ data: [], error: null }),
    logoDetectionId
      ? supabase.from("logo_frames").select(
        "frame_id, timestamp_ms, location, confidence_score, prominence, reference_match",
      ).eq("processing_id", logoDetectionId)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("quality_frames").select(
      "frame_id, timestamp_ms, reasons, sharpness, crushed_frac, blown_frac, mean_luma, contrast, grain, blockiness, temporal_delta",
    ).eq("request_id", requestId),
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
      qualityFramesResponse,
    ]
  ) {
    if (response.error) throw response.error;
  }

  const brief = required(briefResponse.data, "Parsed creative brief");

  return AgentContextSchema.parse({
    request_id: requestId,
    campaign_goal: requestRecord.campaign_goal ?? "unknown",
    destination_platform: brief.destination_platform,
    parsed_creative_brief: brief,
    video_metadata: required(metadataResponse.data, "Video metadata"),
    transcript_segments: transcriptResponse.data ?? [],
    ocr_segments: ocrResponse.data ?? [],
    visual_frames: visualResponse.data ?? [],
    product_frames: productFramesResponse.data ?? [],
    logo_frames: logoFramesResponse.data ?? [],
    quality_frames: qualityFramesResponse.data ?? [],
    product_context: productContextResponse.data ?? undefined,
  });
}
