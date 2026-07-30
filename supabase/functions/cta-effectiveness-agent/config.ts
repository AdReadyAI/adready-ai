/**
 * config.ts — Grading config for the cta-effectiveness agent.
 *
 * The tables below are populated from the Config Decisions doc and actively
 * drive grading. The null-tolerant contract is retained: any table set back to
 * `null` degrades its dependent sub-check to cannot_assess via `gateOnConfig`
 * (see checks.ts) rather than grading against an invented bar. Retune a
 * dependency by editing its values; no code change is needed elsewhere.
 */

// ── CTA timing benchmarks (cta_buried, cta_mistimed) ────────────────────────
// The positional windows both deterministic timing checks compare CTA
// timestamps against: the "buried" early-only window (design doc's 5s), and the
// "lands late enough" placement window (design doc's last 20–30%) with a
// minimum on-screen dwell. Populated with the confirmed benchmarks below; if set
// back to null, cta_buried and cta_mistimed return cannot_assess.

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

/** Confirmed CPG benchmarks (Config Decisions doc, table 2). */
export const CTA_TIMING: CtaTiming | null = {
  buried_window_ms: 5000,
  landing_zone_start_fraction: 0.70,
  landing_zone_end_fraction: 1.0,
  min_dwell_ms: 2000,
};

export function getCtaTiming(): CtaTiming | null {
  return CTA_TIMING;
}

// ── CTA visibility thresholds (cta_low_visibility) ──────────────────────────
// The AgentContext schema no longer carries a contrast_ratio (Media dropped it,
// and these agents never inspect pixels), so cta_low_visibility is a SIZE-only
// legibility check: it reads the numeric region_size and font_size_px that
// ocr_segments[] still provide. Thresholds are populated below; if set back to
// null, cta_low_visibility returns cannot_assess.

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

/**
 * Size thresholds from the Config Decisions doc (table 3). region_area_pct_of_frame
 * maps to min/marginal_region_size (values are % of frame, e.g. 0.03 = 3%).
 * NOTE: pending Media's confirmation that ocr_segments.region_size is expressed as
 * % of frame (not raw pixel area or 0–1 normalized) — if not, the region thresholds
 * won't compare correctly. font_size_px units match on both sides.
 */
export const CTA_VISIBILITY: CtaVisibilityThresholds | null = {
  min_region_size: 0.03,
  marginal_region_size: 0.05,
  min_font_size_px: 32,
  marginal_font_size_px: 48,
};

export function getCtaVisibilityThresholds(): CtaVisibilityThresholds | null {
  return CTA_VISIBILITY;
}

// ── CTA phrasing conventions (cta_platform_mismatch) ────────────────────────
// Per-platform table of CTA phrasing that violates current conventions — e.g.
// "swipe up" is stale on modern TikTok. destination_platform is already an
// input; the table is populated below. A platform not in the table resolves to
// null via getPlatformPhrasing, so cta_platform_mismatch returns cannot_assess
// for it.

export type PlatformPhrasing = {
  /** Lowercased phrases that are discouraged / stale on this platform. */
  discouraged_phrases: string[];
};

/**
 * Discouraged/stale CTA phrasings per platform (Config Decisions doc, table 6).
 * Keys are the canonical platform names; lookup via getPlatformPhrasing is case-
 * and whitespace-insensitive, so parsed_creative_briefs.destination_platform
 * values like "tiktok" or " TikTok " still resolve. Phrase casing is irrelevant
 * (both sides are lowercased). The doc's "reason" column is human context only
 * and has no field here.
 */
export const CTA_PHRASING: Readonly<Record<string, PlatformPhrasing>> | null = {
  "TikTok": {
    discouraged_phrases: ["swipe up", "link in bio", "click the link below"],
  },
  "Instagram Reels": {
    discouraged_phrases: ["swipe up", "link in bio", "click below"],
  },
  "YouTube Shorts": {
    discouraged_phrases: ["click below", "link in description", "swipe up"],
  },
};

// Canonical keys indexed by their normalized (lowercased, trimmed) form so a
// destination_platform in any casing resolves to the right phrasing. Built once.
const CTA_PHRASING_BY_NORMALIZED_KEY: Readonly<
  Record<string, PlatformPhrasing>
> = Object.fromEntries(
  Object.entries(CTA_PHRASING ?? {}).map(([key, phrasing]) => [
    key.trim().toLowerCase(),
    phrasing,
  ]),
);

export function getPlatformPhrasing(platform: string): PlatformPhrasing | null {
  return CTA_PHRASING_BY_NORMALIZED_KEY[platform.trim().toLowerCase()] ?? null;
}

// ── campaign_goal → CTA-type benchmark (cta_goal_mismatch) ──────────────────
// Maps each campaign_goal to the CTA type it calls for — none / soft / strong /
// loyalty — with examples, resolved before Call 2 and evaluated against there.
// Populated for the four known goals below; a campaign_goal not in the table
// resolves to null via getGoalBenchmark, so cta_goal_mismatch returns
// cannot_assess for it rather than judging against a partial bar.

export type CtaType = "none" | "soft" | "strong" | "loyalty";

export type GoalBenchmark = {
  expected_cta_type: CtaType;
  /** Example CTA phrasings that satisfy this benchmark, passed into Call 2. */
  examples: string[];
};

/**
 * campaign_goal → expected CTA type + example phrasings (Config Decisions doc,
 * table 4). Enum completeness is still open: if goals beyond these four (app
 * install, lead-gen, retargeting, …) are introduced, add their rows here.
 */
export const CTA_GOAL_BENCHMARK:
  | Readonly<Record<string, GoalBenchmark>>
  | null = {
    awareness: { expected_cta_type: "soft", examples: ["Learn more"] },
    consideration: {
      expected_cta_type: "soft",
      examples: ["See how it works"],
    },
    repurchase: {
      expected_cta_type: "strong",
      examples: ["Reorder now", "Stock up"],
    },
    conversion: {
      expected_cta_type: "strong",
      examples: ["Shop now", "Get 20% off"],
    },
  };

export function getGoalBenchmark(campaignGoal: string): GoalBenchmark | null {
  return CTA_GOAL_BENCHMARK?.[campaignGoal] ?? null;
}
