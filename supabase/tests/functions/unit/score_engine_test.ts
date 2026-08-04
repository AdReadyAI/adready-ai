import { assertEquals } from "jsr:@std/assert@1";
import { SCORE_CONFIG_V0_3 } from "../../../functions/_shared/score-engine/config.ts";
import {
  clampSeverity,
  metricScore,
  normalizeConfidence,
  scoreEngine,
} from "../../../functions/_shared/score-engine/scoreEngine.ts";
import type { MetricInput } from "../../../functions/_shared/score-engine/types.ts";

/** Proposal v0.3 §8 mini-example (Plan A). */
const MINI_EXAMPLE: MetricInput[] = [
  {
    metric_id: "brief_adherence",
    result: "false",
    severity: "medium",
    confidence: "medium",
  },
  {
    metric_id: "product_truth",
    result: "false",
    severity: "critical",
    confidence: "high",
  },
  { metric_id: "product_clarity", result: "true", severity: "none" },
  { metric_id: "brand_fit", result: "true", severity: "none" },
  {
    metric_id: "cta_clarity",
    result: "false",
    severity: "high",
    confidence: "low",
  },
  { metric_id: "creative_effectiveness", result: "true", severity: "none" },
  { metric_id: "audience_channel_fit", result: "true", severity: "none" },
  { metric_id: "production_readiness", result: "true", severity: "none" },
  { metric_id: "policy_compliance", result: "true", severity: "none" },
];

function allTrue(): MetricInput[] {
  return (Object.keys(SCORE_CONFIG_V0_3.weights) as MetricInput["metric_id"][])
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

Deno.test("normalizeConfidence maps omitted to unknown", () => {
  assertEquals(normalizeConfidence(undefined), "unknown");
  assertEquals(normalizeConfidence("high"), "high");
});

Deno.test("metricScore applies severity deductions", () => {
  assertEquals(metricScore("none"), 100);
  assertEquals(metricScore("low"), 95);
  assertEquals(metricScore("medium"), 80);
  assertEquals(metricScore("high"), 60);
  assertEquals(metricScore("critical"), 0);
});

Deno.test("mini-example returns 72 Needs Revision with v0.3 dims and issue confidence", () => {
  const out = scoreEngine(MINI_EXAMPLE);
  const { result_table, issues } = out;

  assertEquals(result_table.config_version, "0.3");
  assertEquals(result_table.ad_readiness_pct, 72);
  assertEquals(result_table.readiness_status, "Needs Revision");

  const byDim = Object.fromEntries(
    result_table.dimensions.map((d) => [d.id, d.score]),
  );
  assertEquals(byDim.claims_accuracy, 0);
  assertEquals(byDim.product_representation, 100);
  assertEquals(byDim.storyline_brief, 91);
  assertEquals(byDim.cta_effectiveness, 60);
  assertEquals(byDim.brand_alignment, 100);
  assertEquals(byDim.visual_asset_quality, 100);

  assertEquals(
    issues.map((f) => f.metric_id),
    ["product_truth", "cta_clarity", "brief_adherence"],
  );
  assertEquals(
    issues.map((f) => f.confidence),
    ["high", "low", "medium"],
  );
  assertEquals(issues[0].title, "product_truth");
});

Deno.test("confidence does not change Ad Ready %", () => {
  const withLow = scoreEngine(
    allTrue().map((row) =>
      row.metric_id === "product_truth"
        ? {
          ...row,
          result: "false" as const,
          severity: "critical" as const,
          confidence: "low" as const,
        }
        : row
    ),
  );
  const withHigh = scoreEngine(
    allTrue().map((row) =>
      row.metric_id === "product_truth"
        ? {
          ...row,
          result: "false" as const,
          severity: "critical" as const,
          confidence: "high" as const,
        }
        : row
    ),
  );
  assertEquals(
    withLow.result_table.ad_readiness_pct,
    withHigh.result_table.ad_readiness_pct,
  );
  assertEquals(withLow.issues[0].confidence, "low");
  assertEquals(withHigh.issues[0].confidence, "high");
});

Deno.test("policy_compliance high failure is High Risk gating", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "policy_compliance"
      ? { ...row, result: "false" as const, severity: "high" as const }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(out.result_table.ad_readiness_pct, 100);
  assertEquals(out.result_table.readiness_status, "High Risk");
  assertEquals(out.issues[0].metric_id, "policy_compliance");
  assertEquals(out.issues[0].title, "Compliance Readiness");
  assertEquals(out.issues[0].confidence, "unknown");
});

Deno.test("maps explanation and recommended_fix to issues table fields", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "product_truth"
      ? {
        ...row,
        result: "false" as const,
        severity: "critical" as const,
        explanation: "Claim not supported",
        recommended_fix: "Remove claim",
        video_timestamp: "00:12",
      }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(out.issues[0].detail, "Claim not supported");
  assertEquals(out.issues[0].repair_suggestion, "Remove claim");
  assertEquals(out.issues[0].video_timestamp, "00:12");
});

Deno.test("production_readiness medium failure does not gate", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "production_readiness"
      ? { ...row, result: "false" as const, severity: "medium" as const }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(out.result_table.readiness_status, "Ready");
  assertEquals(
    out.result_table.dimensions.find((d) => d.id === "visual_asset_quality")
      ?.score,
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
  assertEquals(out.result_table.ad_readiness_pct, 100);
  assertEquals(out.result_table.readiness_status, "Ready");
});

Deno.test("all cannot_assess dimension score is Cannot Assess", () => {
  const inputs = allTrue().map((row) =>
    row.metric_id === "brand_fit"
      ? { ...row, result: "cannot_assess" as const, severity: "none" as const }
      : row
  );
  const out = scoreEngine(inputs);
  assertEquals(
    out.result_table.dimensions.find((d) => d.id === "brand_alignment")?.score,
    "Cannot Assess",
  );
});
