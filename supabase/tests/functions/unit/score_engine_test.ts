import { assertEquals } from "@std/assert";
import { SCORE_CONFIG_V0_2 } from "../../../functions/_shared/score-engine/config.ts";
import {
  clampSeverity,
  metricScore,
  scoreEngine,
} from "../../../functions/_shared/score-engine/scoreEngine.ts";
import type { MetricInput } from "../../../functions/_shared/score-engine/types.ts";

/** Proposal §7 mini-example. */
const MINI_EXAMPLE: MetricInput[] = [
  { metric_id: "brief_adherence", result: "false", severity: "medium" },
  { metric_id: "product_truth", result: "false", severity: "critical" },
  { metric_id: "product_clarity", result: "true", severity: "none" },
  { metric_id: "audience_fit", result: "true", severity: "none" },
  { metric_id: "brand_fit", result: "true", severity: "none" },
  { metric_id: "cta_clarity", result: "false", severity: "high" },
  { metric_id: "channel_readiness", result: "true", severity: "none" },
  { metric_id: "creative_effectiveness", result: "true", severity: "none" },
  { metric_id: "production_readiness", result: "true", severity: "none" },
  { metric_id: "policy_compliance", result: "true", severity: "none" },
];

function allTrue(): MetricInput[] {
  return (Object.keys(SCORE_CONFIG_V0_2.weights) as MetricInput["metric_id"][])
    .map((metric_id) => ({
      metric_id,
      result: "true" as const,
      severity: "none" as const,
    }));
}

Deno.test("clampSeverity forces none when result is true or cannot_assess", () => {
  assertEquals(clampSeverity("true", "critical"), "none");
  assertEquals(clampSeverity("cannot_assess", "high"), "none");
  assertEquals(clampSeverity("false", "medium"), "medium");
});

Deno.test("metricScore applies v0.2 severity deductions", () => {
  assertEquals(metricScore("none"), 100);
  assertEquals(metricScore("low"), 95);
  assertEquals(metricScore("medium"), 80);
  assertEquals(metricScore("high"), 60);
  assertEquals(metricScore("critical"), 0);
});

Deno.test("mini-example returns 72 Needs Revision with expected dims and fix order", () => {
  const out = scoreEngine(MINI_EXAMPLE);

  assertEquals(out.config_version, "0.2");
  assertEquals(out.ad_readiness_pct, 72);
  assertEquals(out.readiness_status, "Needs Revision");
  assertEquals(out.gating_failures, []);

  const byDim = Object.fromEntries(out.dimensions.map((d) => [d.id, d.score]));
  assertEquals(byDim.claims_accuracy, 0);
  assertEquals(byDim.product_representation, 100);
  assertEquals(byDim.storyline_brief, 88.6);
  assertEquals(byDim.cta_effectiveness, 60);
  assertEquals(byDim.brand_alignment, 100);
  assertEquals(byDim.visual_asset_quality, 100);

  assertEquals(
    out.priority_fix_list.map((f) => f.metric_id),
    ["product_truth", "cta_clarity", "brief_adherence"],
  );
});

Deno.test("policy_compliance high failure is High Risk gating", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "policy_compliance"
      ? { ...row, result: "false" as const, severity: "high" as const }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(out.ad_readiness_pct, 100);
  assertEquals(out.readiness_status, "High Risk");
  assertEquals(out.gating_failures.length, 1);
  assertEquals(out.gating_failures[0].metric_id, "policy_compliance");
  assertEquals(out.priority_fix_list[0].metric_id, "policy_compliance");
  assertEquals(out.priority_fix_list[0].is_gating_failure, true);
});

Deno.test("production_readiness medium failure does not gate", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "production_readiness"
      ? { ...row, result: "false" as const, severity: "medium" as const }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(out.gating_failures, []);
  assertEquals(out.readiness_status, "Ready");
  assertEquals(
    out.dimensions.find((d) => d.id === "visual_asset_quality")?.score,
    80,
  );
});

Deno.test("cannot_assess is excluded from Ad Ready % weight sum", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "creative_effectiveness"
      ? { ...row, result: "cannot_assess" as const, severity: "none" as const }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(out.applicable_weight_sum, 95);
  assertEquals(out.ad_readiness_pct, 100);
  assertEquals(out.readiness_status, "Ready");
});
