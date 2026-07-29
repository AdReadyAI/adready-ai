/** Rubric v0.3 metric identifiers. */
export type MetricId =
  | "brief_adherence"
  | "product_truth"
  | "product_clarity"
  | "brand_fit"
  | "cta_clarity"
  | "creative_effectiveness"
  | "audience_channel_fit"
  | "production_readiness"
  | "policy_compliance";

export type MetricResultValue = "true" | "false" | "cannot_assess";

export type Severity = "none" | "low" | "medium" | "high" | "critical";

/** Agent-provided confidence. Omitted input becomes `unknown`. */
export type Confidence = "high" | "medium" | "low";

export type ConfidenceLevel = Confidence | "unknown";

export type ReadinessStatus =
  | "Ready"
  | "Needs Revision"
  | "High Risk"
  | "Cannot Assess";

/**
 * One agent (or golden) metric row. Score Engine ignores any agent-provided score.
 * explanation / recommended_fix are accepted on input and emitted as
 * detail / repair_suggestion on IssueRow (issuetable column names).
 */
export interface MetricInput {
  metric_id: MetricId;
  result: MetricResultValue;
  severity: Severity;
  /** Optional. Omitted → `unknown` on issue rows. */
  confidence?: Confidence;
  explanation?: string;
  recommended_fix?: string;
  /** Optional passthrough onto IssueRow.video_timestamp. */
  video_timestamp?: string;
  owner?: string;
}

/** Internal scored metric row (not part of the public response). */
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
  /** Passthrough only; does not affect scores. */
  confidence: ConfidenceLevel;
  explanation?: string;
  recommended_fix?: string;
  video_timestamp?: string;
  owner?: string;
}

/** Internal gating row used while computing status / High Risk. */
export interface GatingFailure {
  metric_id: MetricId;
  severity: Severity;
  label: string;
}

/**
 * One issue row shaped for public.issuetable (Samy).
 * Orchestrator adds request_id, batch_id, created_at on INSERT.
 * Array order is the Score Engine priority order (not a stored column).
 */
export interface IssueRow {
  metric_id: MetricId;
  title: string;
  detail?: string;
  severity: Severity;
  confidence: ConfidenceLevel;
  repair_suggestion?: string;
  video_timestamp?: string;
}

/** One dimension cell on the result table. */
export interface ResultDimension {
  id: string;
  name: string;
  /** Integer 0–100, or Cannot Assess when no applicable member metrics. */
  score: number | "Cannot Assess";
}

/**
 * Frontend / Edge result payload.
 * DB stores the same fields as columns on result_score_table + result_score_dimensions.
 */
export interface ResultTable {
  config_version: string;
  /** Integer 0–100, or null when status is Cannot Assess. */
  ad_readiness_pct: number | null;
  readiness_status: ReadinessStatus;
  dimensions: ResultDimension[];
}

/**
 * Public Score Engine response.
 * result_table → result_score_table + result_score_dimensions (orchestrator);
 * issues[] → issuetable rows.
 */
export interface ScoreTablesOutput {
  result_table: ResultTable;
  issues: IssueRow[];
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
