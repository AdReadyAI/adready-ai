import { assertEquals } from "jsr:@std/assert@1";
import { ALL_METRIC_IDS } from "../../../functions/shared/score-engine/config.ts";
import { metricInputsFromAgentResults } from "../../../functions/shared/score-engine/fromAgentResults.ts";
import { resultTableToDbRows } from "../../../functions/shared/score-engine/persistResultTable.ts";
import { scoreEngine } from "../../../functions/shared/score-engine/scoreEngine.ts";
import type { AgentResultScoreRow } from "../../../functions/shared/score-engine/fromAgentResults.ts";

function fullAgentRows(
  patch: Partial<Record<string, Partial<AgentResultScoreRow>>> = {},
): AgentResultScoreRow[] {
  return ALL_METRIC_IDS.map((metric_id) => ({
    metric_id,
    result: "true",
    severity: "none",
    ...patch[metric_id],
  }));
}

Deno.test("metricInputsFromAgentResults accepts complete agent rows", () => {
  const mapped = metricInputsFromAgentResults(
    fullAgentRows({
      product_truth: { result: "false", severity: "critical" },
    }),
  );
  assertEquals(mapped.ok, true);
  if (mapped.ok) {
    assertEquals(mapped.metric_results.length, 9);
  }
});

Deno.test("metricInputsFromAgentResults ignores non-v0.3 metric ids", () => {
  const mapped = metricInputsFromAgentResults([
    ...fullAgentRows(),
    { metric_id: "legacy_channel_readiness", result: "true", severity: "none" },
  ]);
  assertEquals(mapped.ok, true);
});

Deno.test("metricInputsFromAgentResults rejects missing metrics", () => {
  const rows = fullAgentRows().filter((r) => r.metric_id !== "brand_fit");
  const mapped = metricInputsFromAgentResults(rows);
  assertEquals(mapped.ok, false);
  if (!mapped.ok) {
    assertEquals(mapped.error.includes("brand_fit"), true);
  }
});

Deno.test("metricInputsFromAgentResults rejects duplicate metric_id", () => {
  const mapped = metricInputsFromAgentResults([
    ...fullAgentRows(),
    { metric_id: "cta_clarity", result: "false", severity: "high" },
  ]);
  assertEquals(mapped.ok, false);
  if (!mapped.ok) {
    assertEquals(mapped.error.includes("Duplicate"), true);
  }
});

Deno.test("metricInputsFromAgentResults rejects false with severity none", () => {
  const mapped = metricInputsFromAgentResults(
    fullAgentRows({
      product_truth: { result: "false", severity: "none" },
    }),
  );
  assertEquals(mapped.ok, false);
});

Deno.test("resultTableToDbRows maps Cannot Assess to null score", () => {
  const mapped = metricInputsFromAgentResults(
    fullAgentRows({
      production_readiness: {
        result: "cannot_assess",
        severity: "none",
      },
    }),
  );
  assertEquals(mapped.ok, true);
  if (!mapped.ok) return;

  const out = scoreEngine(mapped.metric_results);
  const rows = resultTableToDbRows(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    out.result_table,
    "2026-01-01T00:00:00.000Z",
  );

  assertEquals(rows.overall.config_version, out.result_table.config_version);
  assertEquals(rows.dimensions.length, 6);
  const visual = rows.dimensions.find((d) =>
    d.dimension_id === "visual_asset_quality"
  );
  assertEquals(visual?.score, null);
});

Deno.test("mini-example agent rows score to Needs Revision overall", () => {
  const mapped = metricInputsFromAgentResults(
    fullAgentRows({
      brief_adherence: { result: "false", severity: "medium" },
      product_truth: { result: "false", severity: "critical" },
      cta_clarity: { result: "false", severity: "high" },
    }),
  );
  assertEquals(mapped.ok, true);
  if (!mapped.ok) return;

  const out = scoreEngine(mapped.metric_results);
  assertEquals(out.result_table.ad_readiness_pct, 72);
  assertEquals(out.result_table.readiness_status, "Needs Revision");

  const rows = resultTableToDbRows(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    out.result_table,
  );
  assertEquals(rows.overall.ad_readiness_pct, 72);
  assertEquals(rows.overall.readiness_status, "Needs Revision");
});
