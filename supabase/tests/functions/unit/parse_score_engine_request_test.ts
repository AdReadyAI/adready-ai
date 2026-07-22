import { assertEquals } from "jsr:@std/assert@1";
import { parseScoreEngineRequest } from "../../../functions/_shared/score-engine/parseRequest.ts";

Deno.test("parseScoreEngineRequest accepts valid metric_results", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: [
      {
        metric_id: "product_truth",
        result: "false",
        severity: "critical",
      },
    ],
  });
  assertEquals(parsed.ok, true);
  if (parsed.ok) {
    assertEquals(parsed.metric_results.length, 1);
    assertEquals(parsed.metric_results[0].metric_id, "product_truth");
  }
});

Deno.test("parseScoreEngineRequest rejects missing metric_results", () => {
  const parsed = parseScoreEngineRequest({});
  assertEquals(parsed.ok, false);
  if (!parsed.ok) {
    assertEquals(parsed.error.includes("metric_results"), true);
  }
});

Deno.test("parseScoreEngineRequest rejects invalid metric_id", () => {
  const parsed = parseScoreEngineRequest({
    metric_results: [
      { metric_id: "not_a_metric", result: "true", severity: "none" },
    ],
  });
  assertEquals(parsed.ok, false);
});
