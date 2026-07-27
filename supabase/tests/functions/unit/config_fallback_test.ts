/**
 * Unit tests for the config scaffolding (_evaluator/config.ts) and the config
 * gate (_evaluator/subcheck.ts).
 *
 * The contract these lock in: every unresolved dependency defaults to null
 * (unpopulated), and a sub-check gated on it degrades to `cannot_assess` — never
 * a silent guess. One assertion per dependency, plus the gate's open path and
 * the sub-check builders.
 */

import { assertEquals } from "@std/assert";
import {
  cannotAssess,
  failed,
  gateOnConfig,
  passed,
} from "../../../functions/_evaluator/subcheck.ts";
import {
  getArcExpectation,
  getCtaTiming,
  getCtaVisibilityThresholds,
  getGoalBenchmark,
  getPlatformPhrasing,
} from "../../../functions/_evaluator/config.ts";
import { getPlatformSpec } from "../../../functions/_evaluator/config.ts";

/**
 * Each unresolved dependency: a human name, its default accessor (must be null),
 * and the sub-check it gates. The gate must return cannot_assess for all of them
 * until the underlying table/threshold is populated.
 */
const DEPENDENCIES: {
  dependency: string;
  checkId: string;
  accessor: () => unknown;
}[] = [
  {
    dependency: "platform spec table",
    checkId: "format_noncompliant",
    accessor: () => getPlatformSpec("tiktok"),
  },
  {
    dependency: "arc-expectation table",
    checkId: "story_incomplete",
    accessor: () => getArcExpectation(15000),
  },
  {
    dependency: "cta timing benchmarks",
    checkId: "cta_mistimed",
    accessor: () => getCtaTiming(),
  },
  {
    dependency: "region/font-size thresholds",
    checkId: "cta_low_visibility",
    accessor: () => getCtaVisibilityThresholds(),
  },
  {
    dependency: "cta phrasing table",
    checkId: "cta_platform_mismatch",
    accessor: () => getPlatformPhrasing("tiktok"),
  },
  {
    dependency: "goal→CTA-type benchmark",
    checkId: "cta_goal_mismatch",
    accessor: () => getGoalBenchmark("conversion"),
  },
];

for (const { dependency, checkId, accessor } of DEPENDENCIES) {
  Deno.test(`config unpopulated: ${dependency} accessor returns null`, () => {
    assertEquals(accessor(), null);
  });

  Deno.test(`fallback: ${checkId} degrades to cannot_assess while ${dependency} is missing`, () => {
    const result = gateOnConfig(
      accessor(),
      checkId,
      checkId,
      `${dependency} not yet populated`,
      // Must never run while the dependency is null; if it does, the test fails
      // loudly rather than silently guessing a pass.
      () => passed(checkId, checkId),
    );
    assertEquals(result.result, "cannot_assess");
    assertEquals(result.severity, "cannot_assess");
  });
}

Deno.test("gate opens when config is present: evaluate runs with resolved config", () => {
  let ran = false;
  const result = gateOnConfig(
    { buried_window_ms: 5000 },
    "cta_buried",
    "CTA Position Check",
    "cta timing benchmarks not yet populated",
    (cfg) => {
      ran = true;
      assertEquals(cfg.buried_window_ms, 5000);
      return passed("cta_buried", "CTA Position Check");
    },
  );
  assertEquals(ran, true);
  assertEquals(result.result, "passed");
});

Deno.test("gate treats undefined like null (missing key in a populated table)", () => {
  const result = gateOnConfig(
    undefined,
    "cta_platform_mismatch",
    "CTA Platform Alignment",
    "no convention row for this platform",
    () => passed("cta_platform_mismatch", "CTA Platform Alignment"),
  );
  assertEquals(result.result, "cannot_assess");
});

Deno.test("sub-check builders produce well-formed rows", () => {
  assertEquals(passed("c", "Check"), {
    check_id: "c",
    name: "Check",
    result: "passed",
    severity: "none",
  });
  assertEquals(failed("c", "Check", "high", "boom"), {
    check_id: "c",
    name: "Check",
    result: "failed",
    severity: "high",
    explanation: "boom",
  });
  assertEquals(cannotAssess("c", "Check", "no data"), {
    check_id: "c",
    name: "Check",
    result: "cannot_assess",
    severity: "cannot_assess",
    explanation: "no data",
  });
});
