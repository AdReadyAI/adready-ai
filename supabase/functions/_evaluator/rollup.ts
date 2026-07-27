/**
 * rollup.ts — Metric-level rollup, shared by every evaluator agent.
 *
 * An agent runs a set of sub-checks and then rolls them up into the single
 * `result` + `severity` pair carried by the metric_result it returns. This
 * module owns that rule and nothing else; the sub-checks themselves (and the
 * rest of the metric_result envelope) are assembled by each agent.
 *
 * The default rule is **worst-wins**, per the Storyline/CTA spec:
 *
 *   - result   = "false"        if any sub-check failed
 *              = "true"         if at least one sub-check is assessable and none failed
 *              = "cannot_assess" if no sub-check is assessable (all cannot_assess / none present)
 *   - severity = the highest severity among the *failed* sub-checks (worst-wins);
 *                "none" when the metric passes; "cannot_assess" when the metric
 *                cannot be assessed.
 *
 * Worst-wins is a deliberate v1 default, not a hardcoded law: the spec notes the
 * real rollup rule (and any breadth-escalation, e.g. "N mediums escalate to
 * high") is Evaluation Science's to define and tune against the golden dataset.
 * The rule is therefore expressed as a swappable `RollupStrategy`; callers that
 * want a different rule pass their own without touching agent code. The
 * sub_checks[] list always travels with the metric_result, so breadth and the
 * which-one-fired detail survive the rollup for the Score Engine to re-derive.
 */

import type { MetricResult, SeverityLevel, SubCheckResult } from "../shared/schemas.ts";
import { severityRank } from "./severity.ts";

/** The subset of a metric_result that the rollup decides. */
export type RollupOutcome = {
  result: MetricResult["result"]; // "true" | "false" | "cannot_assess"
  severity: SeverityLevel;
};

/** A rollup rule: turns a metric's sub-checks into its result + severity. */
export type RollupStrategy = (
  subChecks: readonly SubCheckResult[],
) => RollupOutcome;

/**
 * The default rollup rule. Judges the metric only on its *assessable* sub-checks
 * (passed or failed); a metric goes `cannot_assess` only when every sub-check
 * under it is `cannot_assess` (or there are none).
 */
export const worstWinsRollup: RollupStrategy = (subChecks) => {
  const failed = subChecks.filter((c) => c.result === "failed");

  if (failed.length > 0) {
    const severity = failed.reduce<SeverityLevel>(
      (
        worst,
        c,
      ) => (severityRank(c.severity) > severityRank(worst)
        ? c.severity
        : worst),
      "none",
    );
    return { result: "false", severity };
  }

  const hasAssessable = subChecks.some((c) => c.result === "passed");
  if (hasAssessable) {
    // Some sub-checks are assessable and none failed → the metric passes.
    return { result: "true", severity: "none" };
  }

  // No assessable sub-checks: every one is cannot_assess, or the list is empty.
  return { result: "cannot_assess", severity: "cannot_assess" };
};

/**
 * Roll a metric's sub-checks up into its result + severity. Defaults to
 * worst-wins; pass a different `strategy` to swap in Evaluation Science's rule.
 */
export function rollupMetric(
  subChecks: readonly SubCheckResult[],
  strategy: RollupStrategy = worstWinsRollup,
): RollupOutcome {
  return strategy(subChecks);
}
