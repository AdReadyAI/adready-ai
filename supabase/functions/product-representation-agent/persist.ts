/**
 * persist.ts � Write MetricResult[] into agent_results (+ evidence, sub_checks).
 *
 * Upserts the parent row, then replaces child evidence/sub_check rows so
 * re-runs stay idempotent for the same (request_id, agent, metric_id).
 */

import { createSupabaseServiceClient } from "../shared/index.ts";
import type { MetricResult } from "../shared/schemas.ts";

export async function persistAgentResults(
  requestId: string,
  results: MetricResult[],
): Promise<void> {
  const supabase = createSupabaseServiceClient();

  for (const r of results) {
    const { error: resultError } = await supabase.from("agent_results").upsert(
      {
        request_id: requestId,
        agent: r.agent,
        metric_id: r.metric_id,
        metric_name: r.metric_name,
        result: r.result,
        severity: r.severity,
        confidence: r.confidence ?? null,
        explanation: r.explanation ?? null,
        suggested_correction: r.suggested_correction ?? null,
        correction_type: r.correction_type ?? null,
      },
      { onConflict: "request_id,agent,metric_id" },
    );

    if (resultError) {
      throw new Error(
        `failed to upsert agent_results (${r.metric_id}): ${resultError.message}`,
      );
    }

    const { error: delEvidenceError } = await supabase
      .from("agent_result_evidence")
      .delete()
      .eq("request_id", requestId)
      .eq("agent", r.agent)
      .eq("metric_id", r.metric_id);

    if (delEvidenceError) {
      throw new Error(
        `failed to clear agent_result_evidence (${r.metric_id}): ${delEvidenceError.message}`,
      );
    }

    const evidenceRows = (r.evidence ?? []).map((e, i) => ({
      request_id: requestId,
      agent: r.agent,
      metric_id: r.metric_id,
      evidence_order: i,
      evidence_type: e.type,
      evidence_text: e.text,
      evidence_timestamp: e.timestamp ?? "",
    }));

    if (evidenceRows.length > 0) {
      const { error: evidenceError } = await supabase
        .from("agent_result_evidence")
        .insert(evidenceRows);
      if (evidenceError) {
        throw new Error(
          `failed to insert agent_result_evidence (${r.metric_id}): ${evidenceError.message}`,
        );
      }
    }

    const { error: delSubError } = await supabase
      .from("agent_result_sub_checks")
      .delete()
      .eq("request_id", requestId)
      .eq("agent", r.agent)
      .eq("metric_id", r.metric_id);

    if (delSubError) {
      throw new Error(
        `failed to clear agent_result_sub_checks (${r.metric_id}): ${delSubError.message}`,
      );
    }

    const subRows = (r.sub_checks ?? []).map((s) => ({
      request_id: requestId,
      agent: r.agent,
      metric_id: r.metric_id,
      check_id: s.check_id,
      name: s.name,
      result: s.result,
      severity: s.severity,
      explanation: s.explanation ?? null,
    }));

    if (subRows.length > 0) {
      const { error: subError } = await supabase
        .from("agent_result_sub_checks")
        .insert(subRows);
      if (subError) {
        throw new Error(
          `failed to insert agent_result_sub_checks (${r.metric_id}): ${subError.message}`,
        );
      }
    }
  }
}
