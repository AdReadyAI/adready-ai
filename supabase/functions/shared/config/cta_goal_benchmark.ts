/**
 * cta_goal_benchmark.ts — campaign_goal → CTA-type benchmark (CTA: cta_goal_mismatch).
 *
 * UNRESOLVED DEPENDENCY (Evaluation Science). Maps each campaign_goal to the CTA
 * type it calls for — none / soft / strong / loyalty — with examples, resolved
 * before Call 2 and evaluated against there. The four examples in the design doc
 * are a starting point, not a complete reference, so the table is treated as
 * unpopulated: until it is supplied, cta_goal_mismatch returns cannot_assess
 * rather than judging against a partial bar.
 */

export type CtaType = "none" | "soft" | "strong" | "loyalty";

export type GoalBenchmark = {
  expected_cta_type: CtaType;
  /** Example CTA phrasings that satisfy this benchmark, passed into Call 2. */
  examples: string[];
};

/** null = unpopulated. Replace with a real table keyed by campaign_goal. */
export const CTA_GOAL_BENCHMARK:
  | Readonly<Record<string, GoalBenchmark>>
  | null = null;

export function getGoalBenchmark(campaignGoal: string): GoalBenchmark | null {
  return CTA_GOAL_BENCHMARK?.[campaignGoal] ?? null;
}
