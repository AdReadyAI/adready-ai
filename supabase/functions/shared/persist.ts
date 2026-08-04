/** Shared atomic writer for normalized evaluator results and child records. */
import { createSupabaseServiceClient } from "./clients.ts";
import type { MetricResult } from "./schemas.ts";
import { validateMetricResults } from "./validation.ts";

/**
 * Replaces every supplied metric and its children in one database transaction.
 *
 * The database function owns the multi-table write so the downstream score
 * engine cannot observe partially replaced evaluator output.
 */
export async function persistMetricResults(
  requestId: string,
  input: MetricResult[],
): Promise<void> {
  const results = validateMetricResults(input);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.rpc("replace_agent_metric_results", {
    p_request_id: requestId,
    p_results: results,
  });
  if (error) throw error;
}
