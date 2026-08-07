import { ALL_METRIC_IDS } from "./config.ts";
import { parseScoreEngineRequest } from "./parseRequest.ts";
import type {
  MetricId,
  MetricInput,
  MetricResultValue,
  Severity,
} from "./types.ts";

/** Minimal agent_results columns needed for result_table scoring. */
export interface AgentResultScoreRow {
  agent: string;
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

const ATOMIC_METRIC_IDS = [
  "brief_adherence",
  "product_truth",
  "product_clarity",
  "audience_fit",
  "channel_readiness",
  "brand_fit",
  "cta_clarity",
  "creative_effectiveness",
  "production_readiness",
  "policy_compliance",
] as const;

type AtomicMetricId = (typeof ATOMIC_METRIC_IDS)[number];

const EXPECTED_ATOMIC = new Set<string>(ATOMIC_METRIC_IDS);
const EXPECTED_AGENT_BY_METRIC: Record<AtomicMetricId, string> = {
  brief_adherence: "brief_alignment",
  product_truth: "claims_accuracy",
  product_clarity: "product_representation",
  audience_fit: "brief_alignment",
  channel_readiness: "storyline_clarity",
  brand_fit: "brand_alignment",
  cta_clarity: "cta_effectiveness",
  creative_effectiveness: "storyline_clarity",
  production_readiness: "visual_quality",
  policy_compliance: "claims_accuracy",
};
const VALID_RESULTS = new Set<string>(["true", "false", "cannot_assess"]);
const VALID_SEVERITIES = new Set<string>([
  "none",
  "low",
  "medium",
  "high",
  "critical",
]);
const FAILURE_SEVERITY_RANK: Record<Exclude<Severity, "none">, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function validateAtomicRow(row: AgentResultScoreRow): string | null {
  const expectedAgent =
    EXPECTED_AGENT_BY_METRIC[row.metric_id as AtomicMetricId];
  if (row.agent !== expectedAgent) {
    return `agent_results metric_id "${row.metric_id}" belongs to agent "${expectedAgent}"`;
  }
  if (!VALID_RESULTS.has(row.result)) {
    return `agent_results metric_id "${row.metric_id}" has invalid result`;
  }
  if (!VALID_SEVERITIES.has(row.severity)) {
    return `agent_results metric_id "${row.metric_id}" has invalid severity`;
  }
  if (row.result === "false" && row.severity === "none") {
    return `agent_results metric_id "${row.metric_id}" requires failure severity`;
  }
  if (row.result !== "false" && row.severity !== "none") {
    return `agent_results metric_id "${row.metric_id}" requires severity none`;
  }
  return null;
}

/** Combine the two evaluator-owned judgments into the Score Engine composite. */
function combineAudienceChannelFit(
  audienceFit: AgentResultScoreRow,
  channelReadiness: AgentResultScoreRow,
): MetricInput {
  const failures = [audienceFit, channelReadiness].filter((row) =>
    row.result === "false"
  );

  if (failures.length > 0) {
    // A known failure remains actionable even if the other judgment abstained.
    const severity = failures
      .map((row) => row.severity as Exclude<Severity, "none">)
      .sort((a, b) => FAILURE_SEVERITY_RANK[b] - FAILURE_SEVERITY_RANK[a])[0];
    return {
      metric_id: "audience_channel_fit",
      result: "false",
      severity,
    };
  }

  if (
    audienceFit.result === "cannot_assess" ||
    channelReadiness.result === "cannot_assess"
  ) {
    return {
      metric_id: "audience_channel_fit",
      result: "cannot_assess",
      severity: "none",
    };
  }

  return {
    metric_id: "audience_channel_fit",
    result: "true",
    severity: "none",
  };
}

/**
 * Map evaluator-owned atomic rows to the nine Score Engine metrics.
 * Unknown future metrics are ignored, while every required atomic metric must
 * appear exactly once. Audience and channel judgments are combined here so
 * neither evaluator owns cross-agent scoring policy.
 */
export function metricInputsFromAgentResults(
  rows: AgentResultScoreRow[],
): FromAgentResultsResult {
  const byMetric = new Map<string, AgentResultScoreRow>();

  for (const row of rows) {
    if (!EXPECTED_ATOMIC.has(row.metric_id)) {
      continue;
    }
    const validationError = validateAtomicRow(row);
    if (validationError) return { ok: false, error: validationError };
    if (byMetric.has(row.metric_id)) {
      return {
        ok: false,
        error: `Duplicate agent_results row for metric_id "${row.metric_id}"`,
      };
    }
    byMetric.set(row.metric_id, row);
  }

  const missing = ATOMIC_METRIC_IDS.filter((id) => !byMetric.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `agent_results missing metric_id(s): ${missing.join(", ")}`,
    };
  }

  const metric_results: MetricInput[] = ALL_METRIC_IDS.map((metric_id) => {
    if (metric_id === "audience_channel_fit") {
      return combineAudienceChannelFit(
        byMetric.get("audience_fit")!,
        byMetric.get("channel_readiness")!,
      );
    }

    const row = byMetric.get(metric_id as AtomicMetricId)!;
    return {
      metric_id: metric_id as MetricId,
      result: row.result as MetricResultValue,
      severity: row.severity as Severity,
    };
  });

  const parsed = parseScoreEngineRequest({ metric_results });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  return { ok: true, metric_results: parsed.metric_results };
}
