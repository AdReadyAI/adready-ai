/**
 * metric.ts — Assemble a MetricResult from its sub-checks + metric-level fields.
 *
 * Every agent builds its metric_results the same way: gather the sub_checks,
 * roll them up into result + severity (shared rule), and attach the metric-level
 * fields (confidence, evidence, explanation, correction). This keeps the rollup
 * and the envelope shape in one place so no agent hand-rolls (and skews) it.
 */

import type { EvidenceRef, MetricResult, SubCheckResult } from "../schemas.ts";
import { rollupMetric, type RollupStrategy } from "./rollup.ts";

export type MetricLevelFields = {
  confidence?: MetricResult["confidence"];
  evidence?: EvidenceRef[];
  explanation?: string;
  suggested_correction?: string;
  correction_type?: MetricResult["correction_type"];
};

export function assembleMetric(
  spec: {
    metric_id: MetricResult["metric_id"];
    agent: MetricResult["agent"];
    metric_name: string;
    question: string;
    sub_checks: SubCheckResult[];
    fields?: MetricLevelFields;
  },
  strategy?: RollupStrategy,
): MetricResult {
  const { result, severity } = rollupMetric(spec.sub_checks, strategy);
  return {
    metric_id: spec.metric_id,
    agent: spec.agent,
    metric_name: spec.metric_name,
    question: spec.question,
    result,
    severity,
    ...spec.fields,
    sub_checks: spec.sub_checks,
  };
}
