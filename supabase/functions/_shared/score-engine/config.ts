import type { ScoreEngineConfig } from "./types.ts";

/**
 * Machine-readable Score Engine v0.2 config.
 * Mirrors docs/eval/score-engine/score_config_v0.2.yaml
 */
export const SCORE_CONFIG_V0_2: ScoreEngineConfig = {
  version: "0.2",
  weights: {
    brief_adherence: 20,
    product_truth: 20,
    product_clarity: 15,
    audience_fit: 10,
    brand_fit: 10,
    cta_clarity: 10,
    channel_readiness: 10,
    creative_effectiveness: 5,
    production_readiness: 0,
    policy_compliance: 0,
  },
  severity_deductions: {
    none: 0,
    low: 5,
    medium: 20,
    high: 40,
    critical: 100,
  },
  thresholds: {
    ready_min: 85,
    needs_revision_min: 65,
  },
  gating_rules: [
    {
      metric_id: "production_readiness",
      min_severity: "high",
      label: "Asset Readiness",
    },
    {
      metric_id: "policy_compliance",
      min_severity: "high",
      label: "Compliance Readiness",
    },
  ],
  scored_high_critical_is_gating: false,
  display_dimensions: [
    {
      id: "claims_accuracy",
      name: "Claims Accuracy",
      metrics: ["product_truth"],
    },
    {
      id: "product_representation",
      name: "Product Representation",
      metrics: ["product_clarity"],
    },
    {
      id: "storyline_brief",
      name: "Storyline & Brief",
      metrics: [
        "brief_adherence",
        "creative_effectiveness",
        "channel_readiness",
      ],
    },
    {
      id: "cta_effectiveness",
      name: "CTA Effectiveness",
      metrics: ["cta_clarity"],
    },
    {
      id: "brand_alignment",
      name: "Brand Alignment",
      metrics: ["brand_fit", "audience_fit"],
    },
    {
      id: "visual_asset_quality",
      name: "Visual / Asset Quality",
      metrics: ["production_readiness"],
      also_gating: true,
    },
  ],
  gating_sort_effective_weight: 100,
};

export const ALL_METRIC_IDS = Object.keys(
  SCORE_CONFIG_V0_2.weights,
) as Array<keyof typeof SCORE_CONFIG_V0_2.weights>;
