import { SCORE_CONFIG_V0_3 } from "./config.ts";
import type {
  Confidence,
  ConfidenceLevel,
  GatingFailure,
  IssueRow,
  MetricId,
  MetricInput,
  MetricResultValue,
  ReadinessStatus,
  ResultDimension,
  ScoredMetric,
  ScoreEngineConfig,
  ScoreTablesOutput,
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

function roundInt(n: number): number {
  return Math.round(n);
}

/** Internal dimension rollup before public result-table serialization. */
interface InternalDimension {
  id: string;
  name: string;
  score: number | null;
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

/** Omitted confidence → unknown (do not invent high). */
export function normalizeConfidence(
  confidence: Confidence | undefined,
): ConfidenceLevel {
  return confidence ?? "unknown";
}

export function metricScore(
  severity: Severity,
  config: ScoreEngineConfig = SCORE_CONFIG_V0_3,
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
    confidence: normalizeConfidence(input?.confidence),
    explanation: input?.explanation,
    recommended_fix: input?.recommended_fix,
    video_timestamp: input?.video_timestamp,
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
): InternalDimension[] {
  return config.display_dimensions.map((dim) => {
    const members = dim.metrics
      .map((id) => byId.get(id))
      .filter((m): m is ScoredMetric => !!m && m.result !== "cannot_assess");

    if (members.length === 0) {
      return {
        id: dim.id,
        name: dim.name,
        score: null,
      };
    }

    const weightSum = members.reduce((s, m) => s + m.weight, 0);
    // Visual uses production_readiness weight 0 — use metric_score directly.
    if (weightSum === 0) {
      return {
        id: dim.id,
        name: dim.name,
        score: members[0].metric_score,
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
    };
  });
}

function toResultDimensions(dims: InternalDimension[]): ResultDimension[] {
  return dims.map((d) => ({
    id: d.id,
    name: d.name,
    score: d.score === null ? "Cannot Assess" : roundInt(d.score),
  }));
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

function issueTitle(
  metric: ScoredMetric,
  config: ScoreEngineConfig,
): string {
  if (metric.is_gating_failure) {
    const rule = config.gating_rules.find((r) =>
      r.metric_id === metric.metric_id
    );
    if (rule?.label) return rule.label;
  }
  return metric.metric_id;
}

/**
 * Build issues-table-shaped rows (no request_id / batch_id — orchestrator fills those).
 * Array order is priority (gating → severity → weight).
 */
function buildIssues(
  metrics: ScoredMetric[],
  config: ScoreEngineConfig,
): IssueRow[] {
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
    .map((m) => {
      const row: IssueRow = {
        metric_id: m.metric_id,
        title: issueTitle(m, config),
        severity: m.severity,
        confidence: m.confidence,
      };
      if (m.explanation !== undefined) row.detail = m.explanation;
      if (m.recommended_fix !== undefined) {
        row.repair_suggestion = m.recommended_fix;
      }
      if (m.video_timestamp !== undefined) {
        row.video_timestamp = m.video_timestamp;
      }
      return row;
    });
}

/**
 * Score Engine v0.3: metric_results → result_table + issues[] (public.issues shape).
 * Confidence is passthrough on issues only (non-scoring).
 */
export function scoreEngine(
  inputs: MetricInput[],
  config: ScoreEngineConfig = SCORE_CONFIG_V0_3,
): ScoreTablesOutput {
  const byInput = indexInputs(inputs);
  const metricIds = Object.keys(config.weights) as MetricId[];

  const metricResults = metricIds.map((id) =>
    scoreOne(id, byInput.get(id), config)
  );
  const byId = new Map(metricResults.map((m) => [m.metric_id, m]));

  const { pct } = computeAdReadinessPct(metricResults, config);

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
  const issues = buildIssues(metricResults, config);

  return {
    result_table: {
      config_version: config.version,
      ad_readiness_pct: pct === null ? null : roundInt(pct),
      readiness_status,
      dimensions: toResultDimensions(dimensions),
    },
    issues,
  };
}
