import { assertEquals } from "@std/assert";

import {
  bucketConfidence,
  mapSeverityScore,
  msToTimestamp,
  truncate,
  uniqueCategories,
  worstSeverityScore,
} from "../../../functions/claims-agent/utils.ts";

Deno.test("claims-agent utils formats timestamps with zero padding", () => {
  assertEquals(msToTimestamp(0), "00:00");
  assertEquals(msToTimestamp(61000), "01:01");
  assertEquals(msToTimestamp(125900), "02:05");
});

Deno.test("claims-agent utils maps severity scores", () => {
  assertEquals(mapSeverityScore(0), "none");
  assertEquals(mapSeverityScore(1), "low");
  assertEquals(mapSeverityScore(2), "medium");
  assertEquals(mapSeverityScore(3), "high");
  assertEquals(mapSeverityScore(4), "critical");
});

Deno.test("claims-agent utils returns the worst severity score", () => {
  assertEquals(worstSeverityScore([]), 0);
  assertEquals(worstSeverityScore([0, 1, 2]), 2);
  assertEquals(worstSeverityScore([1, 4, 3]), 4);
});

Deno.test("claims-agent utils buckets confidence levels", () => {
  assertEquals(bucketConfidence(0.2), "low");
  assertEquals(bucketConfidence(0.5), "medium");
  assertEquals(bucketConfidence(0.79), "medium");
  assertEquals(bucketConfidence(0.8), "high");
  assertEquals(bucketConfidence(0.99), "high");
});

Deno.test("claims-agent utils preserves unique verifiable categories", () => {
  assertEquals(
    uniqueCategories([
      { claim_id: "c1", is_verifiable_claim: true, category: "factual_claim", reasoning: "a" },
      { claim_id: "c2", is_verifiable_claim: true, category: "health_or_medical_claim", reasoning: "b" },
      { claim_id: "c3", is_verifiable_claim: false, category: null, reasoning: "c" },
      { claim_id: "c4", is_verifiable_claim: true, category: "factual_claim", reasoning: "d" },
    ]),
    ["factual_claim", "health_or_medical_claim"],
  );
});

Deno.test("claims-agent utils truncates long text with an ellipsis", () => {
  assertEquals(truncate("short text"), "short text");
  assertEquals(truncate("x".repeat(60)), "x".repeat(60));
  assertEquals(truncate("x".repeat(61)), `${"x".repeat(59)}…`);
  assertEquals(truncate("abcdef", 4), "abc…");
});