import { createSupabaseServiceClient } from "../shared/clients.ts";
import { AgentContextSchema } from "../shared/schemas.ts";
import type { AgentContext, MetricResult } from "../shared/schemas.ts";

function required<T>(value: T | null, name: string): T {
  if (value === null) {
    throw new Error(`${name} was not found for this request.`);
  }
  return value;
}

/**
 * Loads the DB-backed context for exactly one request. The authenticated
 * owner is checked before using the service-role client for all context joins.
 */
export async function loadBrandContext(
  requestId: string,
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

  const { data: processing, error: processingError } = await supabase
    .from("video_processing")
    .select("id, task_name")
    .eq("request_id", requestId);
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
    supabase.from("visual_frames").select(
      "frame_id, timestamp_ms, image_url, visual_description, people, color_palette, background, camera_movement, technical_flags",
    ).eq("request_id", requestId),
    supabase.from("product_frames").select(
      "frame_id, timestamp_ms, location, confidence_score, prominence, focus_quality, framing, usage_context",
    ).eq("request_id", requestId),
    supabase.from("logo_frames").select(
      "frame_id, timestamp_ms, location, confidence_score, prominence, reference_match",
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
    ]
  ) {
    if (response.error) throw response.error;
  }

  return AgentContextSchema.parse({
    request_id: requestId,
    campaign_goal: required(request, "Request").campaign_goal ?? "unknown",
    destination_platform: required(briefResponse.data, "Parsed creative brief")
      .destination_platform,
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

/** Stores one metric result plus its evidence and sub-checks for a request. */
export async function persistBrandResult(
  requestId: string,
  result: MetricResult,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const resultKey = {
    request_id: requestId,
    agent: result.agent,
    metric_id: result.metric_id,
  };
  const { error } = await supabase.from("agent_results").upsert({
    ...resultKey,
    metric_name: result.metric_name,
    result: result.result,
    severity: result.severity,
    confidence: result.confidence ?? null,
    explanation: result.explanation ?? null,
    suggested_correction: result.suggested_correction ?? null,
    correction_type: result.correction_type ?? null,
  }, { onConflict: "request_id,agent,metric_id" });
  if (error) throw error;

  const [evidenceDelete, subChecksDelete] = await Promise.all([
    supabase.from("agent_result_evidence").delete().match(resultKey),
    supabase.from("agent_result_sub_checks").delete().match(resultKey),
  ]);
  if (evidenceDelete.error) throw evidenceDelete.error;
  if (subChecksDelete.error) throw subChecksDelete.error;

  if (result.evidence?.length) {
    const { error: evidenceError } = await supabase
      .from("agent_result_evidence")
      .insert(result.evidence.map((evidence, evidence_order) => ({
        ...resultKey,
        evidence_order,
        evidence_type: evidence.type,
        evidence_text: evidence.text,
        evidence_timestamp: evidence.timestamp,
      })));
    if (evidenceError) throw evidenceError;
  }

  if (result.sub_checks?.length) {
    const { error: subChecksError } = await supabase
      .from("agent_result_sub_checks")
      .insert(result.sub_checks.map((check) => ({
        ...resultKey,
        check_id: check.check_id,
        name: check.name,
        result: check.result,
        severity: check.severity,
        explanation: check.explanation ?? null,
      })));
    if (subChecksError) throw subChecksError;
  }
}
