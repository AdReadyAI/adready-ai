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
 * Requires user Bearer JWT (see functions/shared createEdgeHandler).
 */
import { z } from "zod";
import {
  metricInputsFromAgentResults,
  resultTableToDbRows,
  scoreEngine,
} from "../shared/score-engine/index.ts";
import { createSupabaseServiceClient } from "../shared/clients.ts";
import { createEdgeHandler } from "../shared/handler.ts";
import { err, ok } from "../shared/response.ts";

const RequestSchema = z.object({
  request_id: z.string().uuid(),
  batch_id: z.string().uuid(),
});

createEdgeHandler("score-result", RequestSchema, async (_req, ctx) => {
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
    .select("metric_id, result, severity")
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

  const { error: upsertOverallError } = await supabase
    .from("result_score_table")
    .upsert(overall, { onConflict: "request_id" });

  if (upsertOverallError) {
    return err(
      "RESULT_UPSERT_FAILED",
      `Failed to upsert result_score_table: ${upsertOverallError.message}`,
      500,
    );
  }

  const { error: deleteDimsError } = await supabase
    .from("result_score_dimensions")
    .delete()
    .eq("request_id", request_id);

  if (deleteDimsError) {
    return err(
      "RESULT_DIMENSIONS_CLEAR_FAILED",
      `Failed to clear result_score_dimensions: ${deleteDimsError.message}`,
      500,
    );
  }

  const { error: insertDimsError } = await supabase
    .from("result_score_dimensions")
    .insert(dimensions);

  if (insertDimsError) {
    return err(
      "RESULT_DIMENSIONS_INSERT_FAILED",
      `Failed to insert result_score_dimensions: ${insertDimsError.message}`,
      500,
    );
  }

  return ok({
    request_id,
    batch_id,
    result_table: output.result_table,
  });
});
