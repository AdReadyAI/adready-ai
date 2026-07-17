import { SCORE_CONFIG_V0_2 } from "./config.ts";
import type {
  DimensionScore,
  FixListItem,
  GatingFailure,
  MetricId,
  MetricInput,
  MetricResultValue,
  ReadinessStatus,
  ScoreEngineConfig,
  ScoreEngineOutput,
  ScoredMetric,
  Severity,
} from "./types.ts";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const GATING_SEVERITY_RANK: Record<"high" | "critical", number> = {
  high: 1,
  critical: 0,
};

function round1(n: number): number {
  return Number(n.toFixed(1));
}

/** true / cannot_assess always use severity none. */
export function clampSeverity(
  result: MetricResultValue,
  severity: Severity,
): Severity {
  if (result === "true" || result === "cannot_assess") {
    return "none";
  }
  return severity;
}

export function metricScore(
  severity: Severity,
  config: ScoreEngineConfig = SCORE_CONFIG_V0_2,
): number {
  return 100 - config.severity_deductions[severity];
}

function isGatingFailure(
  metricId: MetricId,
  result: MetricResultValue,
  severity: Severity,
  config: ScoreEngineConfig,
): boolean {
  if (result !== "false") return false;
  const rule = config.gating_rules.find((r) => r.metric_id === metricId);
  if (!rule) return false;
  return SEVERITY_RANK[severity] <= GATING_SEVERITY_RANK[rule.min_severity];
}

function sortWeight(
  metricId: MetricId,
  isGate: boolean,
  config: ScoreEngineConfig,
): number {
  if (isGate) return config.gating_sort_effective_weight;
  return config.weights[metricId];
}

function indexInputs(inputs: MetricInput[]): Map<MetricId, MetricInput> {
  const map = new Map<MetricId, MetricInput>();
  for (const row of inputs) {
    map.set(row.metric_id, row);
  }
  return map;
}

function scoreOne(
  metricId: MetricId,
  input: MetricInput | undefined,
  config: ScoreEngineConfig,
): ScoredMetric {
  const result = input?.result ?? "cannot_assess";
  const severity = clampSeverity(result, input?.severity ?? "none");
  const score = result === "cannot_assess"
    ? null
    : metricScore(severity, config);
  const coef = score === null ? null : score / 100;
  const gating = isGatingFailure(metricId, result, severity, config);

  return {
    metric_id: metricId,
    result,
    severity,
    weight: config.weights[metricId],
    metric_score: score,
    coef,
    is_gating_failure: gating,
    explanation: input?.explanation,
    recommended_fix: input?.recommended_fix,
    owner: input?.owner,
  };
}

function computeAdReadinessPct(
  metrics: ScoredMetric[],
  config: ScoreEngineConfig,
): { pct: number | null; weightSum: number } {
  const applicable = metrics.filter(
    (m) =>
      config.weights[m.metric_id] > 0 &&
      m.result !== "cannot_assess" &&
      m.coef !== null,
  );

  const weightSum = applicable.reduce((s, m) => s + m.weight, 0);
  if (weightSum === 0) {
    return { pct: null, weightSum: 0 };
  }

  const weighted = applicable.reduce(
    (s, m) => s + m.weight * (m.coef as number),
    0,
  );
  return { pct: round1((weighted / weightSum) * 100), weightSum };
}

function computeDimensions(
  byId: Map<MetricId, ScoredMetric>,
  config: ScoreEngineConfig,
): DimensionScore[] {
  return config.display_dimensions.map((dim) => {
    const members = dim.metrics
      .map((id) => byId.get(id))
      .filter((m): m is ScoredMetric => !!m && m.result !== "cannot_assess");

    if (members.length === 0) {
      return {
        id: dim.id,
        name: dim.name,
        score: null,
        metrics: dim.metrics,
        also_gating: dim.also_gating,
      };
    }

    const weightSum = members.reduce((s, m) => s + m.weight, 0);
    // Visual uses production_readiness weight 0 — use metric_score directly.
    if (weightSum === 0) {
      return {
        id: dim.id,
        name: dim.name,
        score: members[0].metric_score,
        metrics: dim.metrics,
        also_gating: dim.also_gating,
      };
    }

    const weighted = members.reduce(
      (s, m) => s + m.weight * (m.metric_score as number),
      0,
    );
    return {
      id: dim.id,
      name: dim.name,
      score: round1(weighted / weightSum),
      metrics: dim.metrics,
      also_gating: dim.also_gating,
    };
  });
}

function computeStatus(
  pct: number | null,
  gatingFailures: GatingFailure[],
  config: ScoreEngineConfig,
): ReadinessStatus {
  if (pct === null && gatingFailures.length === 0) {
    return "Cannot Assess";
  }
  if (gatingFailures.length > 0) {
    return "High Risk";
  }
  if (pct !== null && pct >= config.thresholds.ready_min) {
    return "Ready";
  }
  if (pct !== null && pct >= config.thresholds.needs_revision_min) {
    return "Needs Revision";
  }
  return "High Risk";
}

function buildFixList(
  metrics: ScoredMetric[],
  config: ScoreEngineConfig,
): FixListItem[] {
  return metrics
    .filter((m) => m.result === "false")
    .sort((a, b) => {
      const gateDiff = Number(b.is_gating_failure) -
        Number(a.is_gating_failure);
      if (gateDiff !== 0) return gateDiff;

      const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sevDiff !== 0) return sevDiff;

      const wDiff = sortWeight(b.metric_id, b.is_gating_failure, config) -
        sortWeight(a.metric_id, a.is_gating_failure, config);
      if (wDiff !== 0) return wDiff;

      return a.metric_id.localeCompare(b.metric_id);
    })
    .map((m, index) => ({
      priority: index + 1,
      metric_id: m.metric_id,
      severity: m.severity,
      is_gating_failure: m.is_gating_failure,
      explanation: m.explanation,
      recommended_fix: m.recommended_fix,
      owner: m.owner,
    }));
}

/**
 * Score Engine v0.2: metric_results → Ad Ready %, status, dimensions, gating, fix list.
 */
export function scoreEngine(
  inputs: MetricInput[],
  config: ScoreEngineConfig = SCORE_CONFIG_V0_2,
): ScoreEngineOutput {
  const byInput = indexInputs(inputs);
  const metricIds = Object.keys(config.weights) as MetricId[];

  const metricResults = metricIds.map((id) =>
    scoreOne(id, byInput.get(id), config)
  );
  const byId = new Map(metricResults.map((m) => [m.metric_id, m]));

  const { pct, weightSum } = computeAdReadinessPct(metricResults, config);

  const gatingFailures: GatingFailure[] = metricResults
    .filter((m) => m.is_gating_failure)
    .map((m) => {
      const rule = config.gating_rules.find((r) => r.metric_id === m.metric_id);
      return {
        metric_id: m.metric_id,
        severity: m.severity,
        label: rule?.label ?? m.metric_id,
      };
    });

  const dimensions = computeDimensions(byId, config);
  const readiness_status = computeStatus(pct, gatingFailures, config);
  const priority_fix_list = buildFixList(metricResults, config);

  return {
    config_version: config.version,
    ad_readiness_pct: pct,
    readiness_status,
    applicable_weight_sum: weightSum,
    metric_results: metricResults,
    dimensions,
    gating_failures: gatingFailures,
    priority_fix_list,
  };
}
