import { assertEquals } from "jsr:@std/assert@1";
import { ALL_METRIC_IDS } from "../../../functions/shared/score-engine/config.ts";
import { parseScoreEngineRequest } from "../../../functions/shared/score-engine/parseRequest.ts";
import type {
  MetricId,
  MetricInput,
} from "../../../functions/shared/score-engine/types.ts";

/** Full v0.3 set; override individual rows via `patch`. */
function fullMetricResults(
  patch: Partial<Record<MetricId, Partial<MetricInput>>> = {},
): MetricInput[] {
  return ALL_METRIC_IDS.map((metric_id) => ({
    result: "true" as const,
    severity: "none" as const,
    ...patch[metric_id],
    metric_id,
  }));
}

Deno.test("parseScoreEngineRequest accepts complete metric_results", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: fullMetricResults({
      product_truth: {
        result: "false",
        severity: "critical",
        confidence: "high",
      },
    }),
  });
  assertEquals(parsed.ok, true);
  if (parsed.ok) {
    assertEquals(parsed.metric_results.length, 9);
    const truth = parsed.metric_results.find((m) =>
      m.metric_id === "product_truth"
    );
    assertEquals(truth?.confidence, "high");
  }
});

Deno.test("parseScoreEngineRequest accepts audience_channel_fit in full set", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: fullMetricResults(),
  });
  assertEquals(parsed.ok, true);
  if (parsed.ok) {
    assertEquals(
      parsed.metric_results.some((m) => m.metric_id === "audience_channel_fit"),
      true,
    );
  }
});

Deno.test("parseScoreEngineRequest rejects unknown legacy metric_ids", () => {
  const rows = fullMetricResults();
  rows[0] = {
    metric_id: "audience_fit" as MetricId,
    result: "true",
    severity: "none",
  };
  const parsed = parseScoreEngineRequest({ metric_results: rows });
  assertEquals(parsed.ok, false);
});

Deno.test("parseScoreEngineRequest rejects missing metric_results", () => {
  const parsed = parseScoreEngineRequest({});
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("metric_results"), true);
  }
});

Deno.test("parseScoreEngineRequest rejects wrong count", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: [
      { metric_id: "product_truth", result: "true", severity: "none" },
    ],
  });
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("exactly 9"), true);
  }
});

Deno.test("parseScoreEngineRequest rejects duplicate metric_id", () => {
  const rows = fullMetricResults();
  rows[1] = { ...rows[0] };
  const parsed = parseScoreEngineRequest({ metric_results: rows });
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("Duplicate"), true);
  }
});

Deno.test("parseScoreEngineRequest rejects invalid metric_id", () => {
  const rows = fullMetricResults();
  rows[0] = {
    metric_id: "not_a_metric" as MetricId,
    result: "true",
    severity: "none",
  };
  const parsed = parseScoreEngineRequest({ metric_results: rows });
  assertEquals(parsed.ok, false);
});

Deno.test("parseScoreEngineRequest rejects invalid confidence", () => {
  const rows = fullMetricResults();
  (rows[0] as { confidence?: string }).confidence = "maybe";
  const parsed = parseScoreEngineRequest({ metric_results: rows });
  assertEquals(parsed.ok, false);
});

Deno.test("parseScoreEngineRequest rejects false with severity none", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: fullMetricResults({
      product_truth: { result: "false", severity: "none" },
    }),
  });
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("result=false"), true);
  }
});

Deno.test("parseScoreEngineRequest rejects true with non-none severity", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: fullMetricResults({
      brand_fit: { result: "true", severity: "high" },
    }),
  });
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("result=true"), true);
  }
});

Deno.test("parseScoreEngineRequest rejects cannot_assess with non-none severity", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: fullMetricResults({
      creative_effectiveness: {
        result: "cannot_assess",
        severity: "medium",
      },
    }),
  });
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("result=cannot_assess"), true);
  }
});

Deno.test("parseScoreEngineRequest accepts false with failure severities", () => {
  for (
    const severity of ["low", "medium", "high", "critical"] as const
  ) {
    const parsed = parseScoreEngineRequest({
      metric_results: fullMetricResults({
        cta_clarity: { result: "false", severity },
      }),
    });
    assertEquals(parsed.ok, true, `expected accept false+${severity}`);
  }
});
