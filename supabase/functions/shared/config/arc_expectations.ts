/**
 * arc_expectations.ts — Duration-based arc-expectation table (Storyline: story_incomplete).
 *
 * UNRESOLVED DEPENDENCY (Evaluation Science). Which arc stages are realistically
 * expected to resolve at a given runtime — a 15s ad has little room for a full
 * arc, a 60s ad does. Feeds the story_incomplete judgment in Call 2. Until the
 * table exists, `getArcExpectation` returns null and story_incomplete returns
 * cannot_assess rather than grading against an invented bar.
 */

export type ArcExpectation = {
  /** Arc roles a well-formed ad of this length is expected to fill. */
  expected_roles: string[];
  /** True if the payoff is expected to resolve on-screen within the runtime. */
  expect_payoff_resolved: boolean;
};

/** null = unpopulated. Replace with a real table keyed by duration bucket. */
export const ARC_EXPECTATIONS: Readonly<Record<string, ArcExpectation>> | null =
  null;

/** Resolve the expectation bucket for a runtime (e.g. 15000 → "15s"). */
export function getArcExpectation(durationMs: number): ArcExpectation | null {
  if (ARC_EXPECTATIONS === null) return null;
  const bucket = durationMs <= 20000
    ? "15s"
    : durationMs <= 45000
    ? "30s"
    : "60s";
  return ARC_EXPECTATIONS[bucket] ?? null;
}
