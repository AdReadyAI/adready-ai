/**
 * config.ts — Unresolved-dependency config for the cta-effectiveness agent.
 *
 * Every threshold/table below is an UNRESOLVED DEPENDENCY the team does not yet
 * own. Each defaults to null (unpopulated) so the dependent sub-check degrades
 * to cannot_assess via `gateOnConfig` (see checks.ts) rather than grading
 * against an invented bar. Populate a dependency by replacing its `null` with a
 * real value; no code change is needed elsewhere.
 */

// ── CTA timing benchmarks (cta_buried, cta_mistimed) ────────────────────────
// The positional windows both deterministic timing checks compare CTA
// timestamps against: the "buried" early-only window (design doc's 5s), and the
// "lands late enough" placement window (design doc's last 20–30%) with a
// minimum on-screen dwell. The math is exact once the numbers are confirmed;
// until then cta_buried and cta_mistimed return cannot_assess.

export type CtaTiming = {
  /** A CTA seen only within this opening window (ms), never repeated, is buried. */
  buried_window_ms: number;
  /** Start of the acceptable landing zone as a fraction of runtime (e.g. 0.70). */
  landing_zone_start_fraction: number;
  /** End of the acceptable landing zone as a fraction of runtime (e.g. 1.0). */
  landing_zone_end_fraction: number;
  /** Minimum on-screen dwell (ms) for a CTA to register. */
  min_dwell_ms: number;
};

/** null = unpopulated. Replace with confirmed CPG benchmarks. */
export const CTA_TIMING: CtaTiming | null = null;

export function getCtaTiming(): CtaTiming | null {
  return CTA_TIMING;
}

// ── CTA visibility thresholds (cta_low_visibility) ──────────────────────────
// The AgentContext schema no longer carries a contrast_ratio (Media dropped it,
// and these agents never inspect pixels), so cta_low_visibility is a SIZE-only
// legibility check: it reads the numeric region_size and font_size_px that
// ocr_segments[] still provide. Only the thresholds are missing. Until they are
// set, cta_low_visibility returns cannot_assess.

export type CtaVisibilityThresholds = {
  /** Below this on-screen region size the CTA text is too small to register. */
  min_region_size: number;
  /** A "marginal" region-size band above min, mapping to low rather than medium. */
  marginal_region_size: number;
  /** Below this font size (px) the CTA text is illegible. */
  min_font_size_px: number;
  /** A "marginal" font-size band above min, mapping to low rather than medium. */
  marginal_font_size_px: number;
};

/** null = unpopulated. Replace with confirmed size thresholds. */
export const CTA_VISIBILITY: CtaVisibilityThresholds | null = null;

export function getCtaVisibilityThresholds(): CtaVisibilityThresholds | null {
  return CTA_VISIBILITY;
}

// ── CTA phrasing conventions (cta_platform_mismatch) ────────────────────────
// Per-platform table of CTA phrasing that violates current conventions — e.g.
// "swipe up" is stale on modern TikTok. destination_platform is already an
// input, so only the table is missing. Until it exists, cta_platform_mismatch
// returns cannot_assess.

export type PlatformPhrasing = {
  /** Lowercased phrases that are discouraged / stale on this platform. */
  discouraged_phrases: string[];
};

/** null = unpopulated. Replace with a real table keyed by destination_platform. */
export const CTA_PHRASING: Readonly<Record<string, PlatformPhrasing>> | null =
  null;

export function getPlatformPhrasing(platform: string): PlatformPhrasing | null {
  return CTA_PHRASING?.[platform] ?? null;
}

// ── campaign_goal → CTA-type benchmark (cta_goal_mismatch) ──────────────────
// Maps each campaign_goal to the CTA type it calls for — none / soft / strong /
// loyalty — with examples, resolved before Call 2 and evaluated against there.
// The four examples in the design doc are a starting point, not a complete
// reference, so the table is treated as unpopulated: until it is supplied,
// cta_goal_mismatch returns cannot_assess rather than judging against a partial
// bar.

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
