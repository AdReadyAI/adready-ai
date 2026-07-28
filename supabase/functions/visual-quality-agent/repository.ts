import { createSupabaseServiceClient } from "../shared/index.ts";
import { AgentContextSchema } from "../shared/schemas.ts";
import type {
  AgentContext,
  MetricResult,
} from "../shared/schemas.ts";

function required<T>(
  value: T | null,
  name: string,
): T {
  if (value === null) {
    throw new Error(
      `${name} was not found for this request.`,
    );
  }

  return value;
}

/**
 * Loads all DB-backed context required by the
 * Visual Quality Agent for one request.
 *
 * The request is first checked against the authenticated
 * user. The service-role client is then used to load the
 * remaining context rows.
 */
export async function loadVisualQualityContext(
  requestId: string,
  userId?: string,
): Promise<AgentContext> {
  if (!userId) {
    throw new Error(
      "Authenticated user is required to load visual quality context.",
    );
  }

  const supabase =
    createSupabaseServiceClient();

  // --------------------------------------------------
  // 1. Load and authorize the request
  // --------------------------------------------------

  const {
    data: request,
    error: requestError,
  } = await supabase
    .from("requests")
    .select(
      "request_id, campaign_goal, user_id",
    )
    .eq("request_id", requestId)
    .eq("user_id", userId)
    .maybeSingle();

  if (requestError) {
    throw requestError;
  }

  const requestRow = required(
    request,
    "Request",
  );

  // --------------------------------------------------
  // 2. Load all supporting context in parallel
  // --------------------------------------------------

  const [
    briefResponse,
    metadataResponse,
    productContextResponse,
    processingResponse,
    ocrResponse,
    visualFramesResponse,
    productFramesResponse,
    logoFramesResponse,
  ] = await Promise.all([
    supabase
      .from("parsed_creative_briefs")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle(),

    supabase
      .from("video_metadata")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle(),

    supabase
      .from("product_context")
      .select("*")
      .eq("request_id", requestId)
      .maybeSingle(),

    supabase
      .from("video_processing")
      .select("id, task_name")
      .eq("request_id", requestId),

    supabase
      .from("ocr_segments")
      .select(
        [
          "ocr_id",
          "frame_ids",
          "start_ms",
          "end_ms",
          "text",
          "on_screen_duration_ms",
          "region_size",
          "font_size_px",
        ].join(", "),
      )
      .eq("request_id", requestId),

    supabase
      .from("visual_frames")
      .select(
        [
          "frame_id",
          "timestamp_ms",
          "image_url",
          "visual_description",
          "people",
          "color_palette",
          "background",
          "camera_movement",
          "technical_flags",
        ].join(", "),
      )
      .eq("request_id", requestId),

    supabase
      .from("product_frames")
      .select(
        [
          "frame_id",
          "timestamp_ms",
          "location",
          "confidence_score",
          "prominence",
          "focus_quality",
          "framing",
          "usage_context",
        ].join(", "),
      )
      .eq("request_id", requestId),

    supabase
      .from("logo_frames")
      .select(
        [
          "frame_id",
          "timestamp_ms",
          "location",
          "confidence_score",
          "prominence",
          "reference_match",
        ].join(", "),
      )
      .eq("request_id", requestId),
  ]);

  // --------------------------------------------------
  // 3. Check DB errors
  // --------------------------------------------------

  const responses = [
    briefResponse,
    metadataResponse,
    productContextResponse,
    processingResponse,
    ocrResponse,
    visualFramesResponse,
    productFramesResponse,
    logoFramesResponse,
  ];

  for (const response of responses) {
    if (response.error) {
      throw response.error;
    }
  }

  // --------------------------------------------------
  // 4. Find transcription processing task
  // --------------------------------------------------

  const transcriptionProcessingId =
    processingResponse.data?.find(
      (row) =>
        row.task_name ===
        "transcription",
    )?.id;

  // --------------------------------------------------
  // 5. Load transcript segments
  // --------------------------------------------------

  let transcriptSegments: unknown[] = [];

  if (transcriptionProcessingId) {
    const {
      data,
      error,
    } = await supabase
      .from("transcript_segments")
      .select(
        [
          "segment_id",
          "start_ms",
          "end_ms",
          "text",
          "speaker",
        ].join(", "),
      )
      .eq(
        "processing_id",
        transcriptionProcessingId,
      );

    if (error) {
      throw error;
    }

    transcriptSegments = data ?? [];
  }

  // --------------------------------------------------
  // 6. Validate required DB records
  // --------------------------------------------------

  const parsedCreativeBrief =
    required(
      briefResponse.data,
      "Parsed creative brief",
    );

  const videoMetadata =
    required(
      metadataResponse.data,
      "Video metadata",
    );

  // --------------------------------------------------
  // 7. Build and validate AgentContext
  // --------------------------------------------------

  return AgentContextSchema.parse({
    request_id: requestId,

    campaign_goal:
      requestRow.campaign_goal ??
      "unknown",

    destination_platform:
      parsedCreativeBrief.destination_platform,

    parsed_creative_brief:
      parsedCreativeBrief,

    video_metadata:
      videoMetadata,

    transcript_segments:
      transcriptSegments,

    ocr_segments:
      ocrResponse.data ?? [],

    visual_frames:
      visualFramesResponse.data ?? [],

    product_frames:
      productFramesResponse.data ?? [],

    logo_frames:
      logoFramesResponse.data ?? [],

    product_context:
      productContextResponse.data ??
      undefined,
  });
}

/**
 * Persists the final Visual Quality metric
 * and its six production-readiness sub-checks.
 */
export async function persistVisualQualityResult(
  requestId: string,
  result: MetricResult,
): Promise<void> {
  const supabase =
    createSupabaseServiceClient();

  const resultKey = {
    request_id: requestId,
    agent: result.agent,
    metric_id: result.metric_id,
  };

  // --------------------------------------------------
  // 1. Upsert main agent result
  // --------------------------------------------------

  const {
    error: resultError,
  } = await supabase
    .from("agent_results")
    .upsert(
      {
        ...resultKey,
        metric_name:
          result.metric_name,
        result:
          result.result,
        severity:
          result.severity,
        confidence:
          result.confidence ??
          null,
        explanation:
          result.explanation ??
          null,
        suggested_correction:
          result.suggested_correction ??
          null,
        correction_type:
          result.correction_type ??
          null,
      },
      {
        onConflict:
          "request_id,agent,metric_id",
      },
    );

  if (resultError) {
    throw resultError;
  }

  // --------------------------------------------------
  // 2. Remove old evidence and sub-checks
  // --------------------------------------------------

  const [
    evidenceDelete,
    subChecksDelete,
  ] = await Promise.all([
    supabase
      .from("agent_result_evidence")
      .delete()
      .match(resultKey),

    supabase
      .from("agent_result_sub_checks")
      .delete()
      .match(resultKey),
  ]);

  if (evidenceDelete.error) {
    throw evidenceDelete.error;
  }

  if (subChecksDelete.error) {
    throw subChecksDelete.error;
  }

  // --------------------------------------------------
  // 3. Persist evidence
  // --------------------------------------------------

  if (result.evidence?.length) {
    const {
      error,
    } = await supabase
      .from("agent_result_evidence")
      .insert(
        result.evidence.map(
          (
            evidence,
            evidence_order,
          ) => ({
            ...resultKey,
            evidence_order,
            evidence_type:
              evidence.type,
            evidence_text:
              evidence.text,
            evidence_timestamp:
              evidence.timestamp,
          }),
        ),
      );

    if (error) {
      throw error;
    }
  }

  // --------------------------------------------------
  // 4. Persist sub-checks
  // --------------------------------------------------

  if (result.sub_checks?.length) {
    const {
      error,
    } = await supabase
      .from("agent_result_sub_checks")
      .insert(
        result.sub_checks.map(
          (check) => ({
            ...resultKey,
            check_id:
              check.check_id,
            name:
              check.name,
            result:
              check.result,
            severity:
              check.severity,
            explanation:
              check.explanation ??
              null,
          }),
        ),
      );

    if (error) {
      throw error;
    }
  }
}