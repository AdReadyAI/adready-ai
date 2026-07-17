/** Rubric v0.1 metric identifiers. */
export type MetricId =
  | "brief_adherence"
  | "product_truth"
  | "product_clarity"
  | "audience_fit"
  | "brand_fit"
  | "cta_clarity"
  | "channel_readiness"
  | "creative_effectiveness"
  | "production_readiness"
  | "policy_compliance";

export type MetricResultValue = "true" | "false" | "cannot_assess";

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export type ReadinessStatus =
  | "Ready"
  | "Needs Revision"
  | "High Risk"
  | "Cannot Assess";

/** One agent (or golden) metric row. Score Engine ignores any agent-provided score. */
export interface MetricInput {
  metric_id: MetricId;
  result: MetricResultValue;
  severity: Severity;
  explanation?: string;
  recommended_fix?: string;
  owner?: string;
}

export interface ScoredMetric {
  metric_id: MetricId;
  result: MetricResultValue;
  /** Effective severity after true/cannot_assess → none. */
  severity: Severity;
  weight: number;
  /** null when result is cannot_assess. */
  metric_score: number | null;
  coef: number | null;
  is_gating_failure: boolean;
  explanation?: string;
  recommended_fix?: string;
  owner?: string;
}

export interface DimensionScore {
  id: string;
  name: string;
  /** null when all member metrics are cannot_assess. */
  score: number | null;
  metrics: MetricId[];
  also_gating?: boolean;
}

export interface GatingFailure {
  metric_id: MetricId;
  severity: Severity;
  label: string;
}

export interface FixListItem {
  priority: number;
  metric_id: MetricId;
  severity: Severity;
  is_gating_failure: boolean;
  explanation?: string;
  recommended_fix?: string;
  owner?: string;
}

export interface ScoreEngineOutput {
  config_version: string;
  ad_readiness_pct: number | null;
  readiness_status: ReadinessStatus;
  applicable_weight_sum: number;
  metric_results: ScoredMetric[];
  dimensions: DimensionScore[];
  gating_failures: GatingFailure[];
  priority_fix_list: FixListItem[];
}

export interface ScoreEngineConfig {
  version: string;
  weights: Record<MetricId, number>;
  severity_deductions: Record<Severity, number>;
  thresholds: {
    ready_min: number;
    needs_revision_min: number;
  };
  gating_rules: Array<{
    metric_id: MetricId;
    min_severity: "high" | "critical";
    label: string;
  }>;
  scored_high_critical_is_gating: boolean;
  display_dimensions: Array<{
    id: string;
    name: string;
    metrics: MetricId[];
    also_gating?: boolean;
  }>;
  gating_sort_effective_weight: number;
}
