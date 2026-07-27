/**
 * config.ts — Unresolved-dependency config for the storyline-clarity agent.
 *
 * Every threshold/table below is an UNRESOLVED DEPENDENCY the team does not yet
 * own. Each defaults to null (unpopulated) so the dependent sub-check degrades
 * to cannot_assess via `gateOnConfig` (see checks.ts) rather than grading
 * against an invented bar. Populate a dependency by replacing its `null` with a
 * real value; no code change is needed elsewhere.
 */

// ── Platform technical-spec table (format_noncompliant) ─────────────────────
// Per-platform aspect ratio, resolution, and duration limits. Until Evaluation
// Science / the platform team supplies this table, `PLATFORM_SPECS` stays null
// and `format_noncompliant` — and therefore the whole single-sub-check
// channel_readiness metric — returns cannot_assess. Populate by replacing
// `null` with a real record keyed by destination_platform.

export type PlatformSpec = {
  allowed_aspect_ratios: string[]; // e.g. ["9:16"]
  min_width: number;
  min_height: number;
  optimal_max_duration_ms: number; // soft limit → low/medium tolerance breach
  max_duration_ms: number; // hard limit → high; ingestion failure → critical
};

/** null = unpopulated. Replace with a real table keyed by destination_platform. */
export const PLATFORM_SPECS: Readonly<Record<string, PlatformSpec>> | null =
  null;

export function getPlatformSpec(platform: string): PlatformSpec | null {
  return PLATFORM_SPECS?.[platform] ?? null;
}

// ── Arc expectations (story_incomplete) ─────────────────────────────────────
// Which arc stages are realistically expected to resolve at a given runtime — a
// 15s ad has little room for a full arc, a 60s ad does. Feeds the
// story_incomplete judgment in Call 2. Until the table exists,
// `getArcExpectation` returns null and story_incomplete returns cannot_assess.

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
