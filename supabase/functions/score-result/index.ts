/**
 * Edge Function: score-result
 *
 * Orchestrator-triggered bridge:
 *   agent_results → Score Engine → result_score_table + result_score_dimensions
 *
 * Does not write public.issues (owned elsewhere).
 * Does not read sub_checks / evidence.
 *
 * POST /functions/v1/score-result
 * Body: { "request_id": uuid, "batch_id": uuid }
 * Requires the internal trigger secret used by pipeline orchestration.
 */
import { z } from "zod";
import {
  metricInputsFromAgentResults,
  resultTableToDbRows,
  scoreEngine,
} from "../shared/score-engine/index.ts";
import { createSupabaseServiceClient } from "../shared/clients.ts";
import { createInternalEdgeHandler } from "../shared/handler.ts";
import { err, ok } from "../shared/response.ts";

const RequestSchema = z.object({
  request_id: z.string().uuid(),
  batch_id: z.string().uuid(),
});

createInternalEdgeHandler("score-result", RequestSchema, async (_req, ctx) => {
  const { request_id, batch_id } = ctx.body;
  const supabase = createSupabaseServiceClient();

  const { data: requestRow, error: requestError } = await supabase
    .from("requests")
    .select("request_id, batch_id")
    .eq("request_id", request_id)
    .maybeSingle();

  if (requestError) {
    return err(
      "REQUEST_LOOKUP_FAILED",
      `Failed to load request: ${requestError.message}`,
      500,
    );
  }
  if (!requestRow) {
    return err("UNKNOWN_REQUEST", `Unknown request_id ${request_id}`, 400);
  }
  if (requestRow.batch_id !== batch_id) {
    return err(
      "BATCH_MISMATCH",
      "batch_id does not match requests.batch_id for this request_id",
      400,
    );
  }

  const { data: agentRows, error: agentError } = await supabase
    .from("agent_results")
    .select("agent, metric_id, result, severity")
    .eq("request_id", request_id);

  if (agentError) {
    return err(
      "AGENT_RESULTS_LOOKUP_FAILED",
      `Failed to load agent_results: ${agentError.message}`,
      500,
    );
  }

  const mapped = metricInputsFromAgentResults(agentRows ?? []);
  if (!mapped.ok) {
    return err("METRICS_NOT_READY", mapped.error, 400);
  }

  const output = scoreEngine(mapped.metric_results);
  const { overall, dimensions } = resultTableToDbRows(
    request_id,
    batch_id,
    output.result_table,
  );

  const { error: persistError } = await supabase.rpc(
    "replace_launch_readiness_scorecard",
    {
      p_request_id: request_id,
      p_batch_id: batch_id,
      p_config_version: overall.config_version,
      p_ad_readiness_pct: overall.ad_readiness_pct,
      p_readiness_status: overall.readiness_status,
      p_dimensions: dimensions,
    },
  );

  if (persistError) {
    return err(
      "SCORECARD_REPLACEMENT_FAILED",
      `Failed to replace Launch-Readiness Scorecard: ${persistError.message}`,
      500,
    );
  }

  return ok({
    request_id,
    batch_id,
    result_table: output.result_table,
  });
});
