import { assertEquals } from "@std/assert";

import {
  confidenceBucket,
  msToTimestamp,
  severityFromScore,
  worstSeverity,
} from "../../../functions/visual-quality-agent/utils.ts";

Deno.test("visual-quality-utils: converts severity score", () => {
  assertEquals(severityFromScore(0), "none");
  assertEquals(severityFromScore(1), "low");
  assertEquals(severityFromScore(2), "medium");
  assertEquals(severityFromScore(3), "high");
  assertEquals(severityFromScore(4), "critical");
});

Deno.test("visual-quality-utils: converts milliseconds to timestamp", () => {
  assertEquals(msToTimestamp(0), "00:00");
  assertEquals(msToTimestamp(7000), "00:07");
  assertEquals(msToTimestamp(65000), "01:05");
  assertEquals(msToTimestamp(125000), "02:05");
});

Deno.test("visual-quality-utils: returns worst severity", () => {
  assertEquals(worstSeverity([]), 0);
  assertEquals(worstSeverity([0, 1, 2]), 2);
  assertEquals(worstSeverity([1, 4, 2]), 4);
});

Deno.test("visual-quality-utils: buckets confidence score", () => {
  assertEquals(confidenceBucket(0.9), "high");
  assertEquals(confidenceBucket(0.8), "high");
  assertEquals(confidenceBucket(0.7), "medium");
  assertEquals(confidenceBucket(0.5), "medium");
  assertEquals(confidenceBucket(0.4), "low");
});
