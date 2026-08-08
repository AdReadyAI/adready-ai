import {
  metricInputsFromAgentResults,
  resultTableToDbRows,
  scoreEngine,
} from "../shared/score-engine/index.ts";
import { createSupabaseServiceClient } from "../shared/clients.ts";

type ProjectionFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
};

type ProjectionSuccess = {
  ok: true;
  resultTable: ReturnType<typeof scoreEngine>["result_table"];
};

export type ScorecardProjectionResult = ProjectionFailure | ProjectionSuccess;

/**
 * Build and atomically replace one Ad Creative's Launch-Readiness Scorecard.
 *
 * Callers provide only stable Review Request identities; this module owns
 * request validation, evaluator input mapping, scoring, and persistence.
 */
export async function projectLaunchReadinessScorecard(
  requestId: string,
  batchId: string,
): Promise<ScorecardProjectionResult> {
  const supabase = createSupabaseServiceClient();
  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("request_id, batch_id")
    .eq("request_id", requestId)
    .maybeSingle();

  if (requestError) {
    return {
      ok: false,
      code: "REQUEST_LOOKUP_FAILED",
      message: `Failed to load request: ${requestError.message}`,
      status: 500,
    };
  }
  if (!requestRow) {
    return {
      ok: false,
      code: "UNKNOWN_REQUEST",
      message: `Unknown request_id ${requestId}`,
      status: 400,
    };
  }
  if (requestRow.batch_id !== batchId) {
    return {
      ok: false,
      code: "BATCH_MISMATCH",
      message: "batch_id does not match requests.batch_id for this request_id",
      status: 400,
    };
  }

  const { data: agentRows, error: agentError } = await supabase
    .from("agent_results")
    .select("agent, metric_id, result, severity")
    .eq("request_id", requestId);
  if (agentError) {
    return {
      ok: false,
      code: "AGENT_RESULTS_LOOKUP_FAILED",
      message: `Failed to load agent_results: ${agentError.message}`,
      status: 500,
    };
  }

  const mapped = metricInputsFromAgentResults(agentRows ?? []);
  if (!mapped.ok) {
    return {
      ok: false,
      code: "METRICS_NOT_READY",
      message: mapped.error,
      status: 400,
    };
  }

  const output = scoreEngine(mapped.metric_results);
  const { overall, dimensions } = resultTableToDbRows(
    requestId,
    batchId,
    output.result_table,
  );
  const { error: persistError } = await supabase.rpc(
    "replace_launch_readiness_scorecard",
    {
      p_request_id: requestId,
      p_batch_id: batchId,
      p_config_version: overall.config_version,
      p_ad_readiness_pct: overall.ad_readiness_pct,
      p_readiness_status: overall.readiness_status,
      p_dimensions: dimensions,
    },
  );
  if (persistError) {
    return {
      ok: false,
      code: "SCORECARD_REPLACEMENT_FAILED",
      message:
        `Failed to replace Launch-Readiness Scorecard: ${persistError.message}`,
      status: 500,
    };
  }

  return { ok: true, resultTable: output.result_table };
}
