/**
 * config.ts — Grading benchmarks for CTA Effectiveness Agent
 */

export type CtaTiming = {
  buried_window_ms: number;
  landing_zone_start_fraction: number;
  landing_zone_end_fraction: number;
  min_dwell_ms: number;
};

export const CTA_TIMING: CtaTiming | null = {
  buried_window_ms: 5000,
  landing_zone_start_fraction: 0.70,
  landing_zone_end_fraction: 1.0,
  min_dwell_ms: 2000,
};

export function getCtaTiming(): CtaTiming | null {
  return CTA_TIMING;
}

export type CtaVisibilityThresholds = {
  min_region_size: number;
  marginal_region_size: number;
  min_font_size_px: number;
  marginal_font_size_px: number;
};

export const CTA_VISIBILITY: CtaVisibilityThresholds | null = {
  min_region_size: 0.03,
  marginal_region_size: 0.05,
  min_font_size_px: 32,
  marginal_font_size_px: 48,
};

export function getCtaVisibilityThresholds(): CtaVisibilityThresholds | null {
  return CTA_VISIBILITY;
}

export type PlatformPhrasing = {
  discouraged_phrases: string[];
};

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

export type CtaType = "none" | "soft" | "strong" | "loyalty";

export type GoalBenchmark = {
  expected_cta_type: CtaType;
  examples: string[];
};

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
