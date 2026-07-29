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

/**
 * Per-platform technical specs (Config Decisions doc, table 5). Keys are the
 * canonical platform names; lookup via getPlatformSpec is case- and
 * whitespace-insensitive, so parsed_creative_briefs.destination_platform values
 * like "tiktok" or " TikTok " still resolve.
 */
export const PLATFORM_SPECS: Readonly<Record<string, PlatformSpec>> | null = {
  "TikTok": {
    allowed_aspect_ratios: ["9:16"],
    min_width: 1080,
    min_height: 1920,
    optimal_max_duration_ms: 34000,
    max_duration_ms: 60000,
  },
  "Instagram Reels": {
    allowed_aspect_ratios: ["9:16"],
    min_width: 1080,
    min_height: 1920,
    optimal_max_duration_ms: 30000,
    max_duration_ms: 90000,
  },
  "YouTube Shorts": {
    allowed_aspect_ratios: ["9:16"],
    min_width: 1080,
    min_height: 1920,
    optimal_max_duration_ms: 60000,
    max_duration_ms: 180000,
  },
};

// Canonical keys indexed by their normalized (lowercased, trimmed) form so a
// destination_platform in any casing resolves to the right spec. Built once.
const PLATFORM_SPECS_BY_NORMALIZED_KEY: Readonly<Record<string, PlatformSpec>> =
  Object.fromEntries(
    Object.entries(PLATFORM_SPECS ?? {}).map(([key, spec]) => [
      key.trim().toLowerCase(),
      spec,
    ]),
  );

export function getPlatformSpec(platform: string): PlatformSpec | null {
  return PLATFORM_SPECS_BY_NORMALIZED_KEY[platform.trim().toLowerCase()] ?? null;
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

/**
 * Arc expectations per duration bucket (Config Decisions doc, table 1). The doc's
 * "tension/problem" maps to the `problem` arc role. payoff_must_be_onscreen maps to
 * expect_payoff_resolved ("resolved before cut").
 *
 * The doc's "turn" role (a complication/twist, listed for 60s) is intentionally
 * omitted: the ARC_ROLES vocabulary is shared across all durations and nothing
 * downstream consumes expected_roles for grading (story_incomplete gates on this
 * table's presence only — Call 2 judges from unfilled_roles/payoff_resolved_at, not
 * these values). Adding "turn" would change Call 1 labeling for every ad with no
 * grading benefit. Reintroduce it only if Eval Science confirms turn-at-60s should
 * be enforced, together with wiring expected_roles into the Call 2 prompt.
 */
export const ARC_EXPECTATIONS: Readonly<Record<string, ArcExpectation>> | null = {
  "15s": { expected_roles: ["hook", "payoff"], expect_payoff_resolved: true },
  "30s": {
    expected_roles: ["hook", "problem", "payoff"],
    expect_payoff_resolved: true,
  },
  "60s": {
    expected_roles: ["hook", "problem", "payoff"],
    expect_payoff_resolved: false,
  },
};

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
