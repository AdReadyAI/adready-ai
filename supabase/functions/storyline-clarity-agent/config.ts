/**
 * config.ts — Grading config for the storyline-clarity agent.
 *
 * The tables below are populated from the Config Decisions doc and actively
 * drive grading. The null-tolerant contract is retained: any table set back to
 * `null` degrades its dependent sub-check to cannot_assess (via `gateOnConfig`
 * in checks.ts, or the explicit null checks in the accessors here) rather than
 * grading against an invented bar. Retune a dependency by editing its values;
 * no code change is needed elsewhere.
 */

// ── Platform technical-spec table (format_noncompliant) ─────────────────────
// Per-platform aspect ratio, resolution, and duration limits, keyed by
// destination_platform. Populated below for the launch platforms; a platform
// not in the table resolves to null via getPlatformSpec, so format_noncompliant
// returns cannot_assess for it rather than grading against an invented spec.

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
  return PLATFORM_SPECS_BY_NORMALIZED_KEY[platform.trim().toLowerCase()] ??
    null;
}

// ── Arc expectations (story_incomplete) ─────────────────────────────────────
// Which arc stages are realistically expected to resolve at a given runtime — a
// 15s ad has little room for a full arc, a 60s ad does. Feeds the
// story_incomplete judgment in Call 2. Populated per duration bucket below; if
// set back to null, `getArcExpectation` returns null and story_incomplete
// returns cannot_assess.

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
 * expected_roles is threaded into the Call 2 prompt as required_arc_roles (see
 * prompts.ts evaluationInput), and story_incomplete grades against it plus
 * expect_payoff_resolved. The doc's "turn" role (a complication/twist, listed for
 * 60s) is intentionally omitted: the ARC_ROLES vocabulary is shared across all
 * durations, and adding "turn" would change Call 1 labeling for every ad.
 * Reintroduce it only if Eval Science confirms turn-at-60s should be enforced.
 */
export const ARC_EXPECTATIONS: Readonly<Record<string, ArcExpectation>> | null =
  {
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
