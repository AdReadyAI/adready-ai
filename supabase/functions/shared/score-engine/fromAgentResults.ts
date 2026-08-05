import { ALL_METRIC_IDS } from "./config.ts";
import { parseScoreEngineRequest } from "./parseRequest.ts";
import type { MetricId, MetricInput } from "./types.ts";

/** Minimal agent_results columns needed for result_table scoring. */
export interface AgentResultScoreRow {
  metric_id: string;
  result: string;
  severity: string;
}

export interface FromAgentResultsSuccess {
  ok: true;
  metric_results: MetricInput[];
}

export interface FromAgentResultsFailure {
  ok: false;
  error: string;
}

export type FromAgentResultsResult =
  | FromAgentResultsSuccess
  | FromAgentResultsFailure;

const EXPECTED = new Set<string>(ALL_METRIC_IDS);

/**
 * Map agent_results rows → validated MetricInput[] for Score Engine.
 * Ignores non-v0.3 metric_ids. Requires exactly one row per v0.3 metric_id.
 */
export function metricInputsFromAgentResults(
  rows: AgentResultScoreRow[],
): FromAgentResultsResult {
  const byMetric = new Map<string, AgentResultScoreRow>();

  for (const row of rows) {
    if (!EXPECTED.has(row.metric_id)) {
      continue;
    }
    if (byMetric.has(row.metric_id)) {
      return {
        ok: false,
        error: `Duplicate agent_results row for metric_id "${row.metric_id}"`,
      };
    }
    byMetric.set(row.metric_id, row);
  }

  const missing = ALL_METRIC_IDS.filter((id) => !byMetric.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `agent_results missing metric_id(s): ${missing.join(", ")}`,
    };
  }

  const metric_results: MetricInput[] = ALL_METRIC_IDS.map((metric_id) => {
    const row = byMetric.get(metric_id)!;
    return {
      metric_id: metric_id as MetricId,
      result: row.result as MetricInput["result"],
      severity: row.severity as MetricInput["severity"],
    };
  });

  const parsed = parseScoreEngineRequest({ metric_results });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  return { ok: true, metric_results: parsed.metric_results };
}
