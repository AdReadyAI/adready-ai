/** Shared writer for normalized metric results and child records. */
import { createSupabaseServiceClient } from "./clients.ts";
import type { MetricResult } from "./schemas.ts";
import { validateMetricResults } from "./validation.ts";

/**
 * Upserts every metric for a request, replacing its evidence and sub-checks.
 */
export async function persistMetricResults(
  requestId: string,
  input: MetricResult[],
): Promise<void> {
  const results = validateMetricResults(input);
  const supabase = createSupabaseServiceClient();

  for (const result of results) {
    const resultKey = {
      request_id: requestId,
      agent: result.agent,
      metric_id: result.metric_id,
    };
    const { error: resultError } = await supabase.from("agent_results").upsert({
      ...resultKey,
      metric_name: result.metric_name,
      result: result.result,
      severity: result.severity,
      confidence: result.confidence ?? null,
      explanation: result.explanation ?? null,
      suggested_correction: result.suggested_correction ?? null,
      correction_type: result.correction_type ?? null,
    }, { onConflict: "request_id,agent,metric_id" });
    if (resultError) throw resultError;

    const [evidenceDelete, subChecksDelete] = await Promise.all([
      supabase.from("agent_result_evidence").delete().match(resultKey),
      supabase.from("agent_result_sub_checks").delete().match(resultKey),
    ]);
    if (evidenceDelete.error) throw evidenceDelete.error;
    if (subChecksDelete.error) throw subChecksDelete.error;

    if (result.evidence?.length) {
      const { error } = await supabase.from("agent_result_evidence").insert(
        result.evidence.map((item, evidence_order) => ({
          ...resultKey,
          evidence_order,
          evidence_type: item.type,
          evidence_text: item.text,
          evidence_timestamp: item.timestamp,
        })),
      );
      if (error) throw error;
    }

    if (result.sub_checks?.length) {
      const { error } = await supabase.from("agent_result_sub_checks").insert(
        result.sub_checks.map((check) => ({
          ...resultKey,
          check_id: check.check_id,
          name: check.name,
          result: check.result,
          severity: check.severity,
          explanation: check.explanation ?? null,
        })),
      );
      if (error) throw error;
    }
  }
}
