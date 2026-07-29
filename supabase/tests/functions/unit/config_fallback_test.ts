/**
 * Unit tests for the per-agent config scaffolding (each agent's config.ts) and
 * the config gate (gateOnConfig in each agent's checks.ts).
 *
 * The contract these lock in: a sub-check gated on a dependency degrades to
 * `cannot_assess` when that dependency is missing (null) — never a silent guess.
 * That gate contract is tested with an explicit null so it holds regardless of
 * whether the live tables are populated. Each dependency below is now populated
 * (Config Decisions doc), so its accessor is asserted non-null, plus the gate's
 * open path and the sub-check builders.
 */

import { assertEquals } from "@std/assert";
import {
  cannotAssess,
  failed,
  gateOnConfig,
  passed,
} from "../../../functions/cta-effectiveness-agent/checks.ts";
import {
  getArcExpectation,
  getPlatformSpec,
} from "../../../functions/storyline-clarity-agent/config.ts";
import {
  getCtaTiming,
  getCtaVisibilityThresholds,
  getGoalBenchmark,
  getPlatformPhrasing,
} from "../../../functions/cta-effectiveness-agent/config.ts";

/**
 * Each dependency: a human name, its populated accessor (now non-null), and the
 * sub-check it gates. The accessor is looked up with a key/value that the doc
 * populated, so it must resolve. The gate must still return cannot_assess when
 * the dependency is missing — verified below with an explicit null.
 */
const DEPENDENCIES: {
  dependency: string;
  checkId: string;
  accessor: () => unknown;
}[] = [
  {
    dependency: "platform spec table",
    checkId: "format_noncompliant",
    accessor: () => getPlatformSpec("TikTok"),
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
    accessor: () => getPlatformPhrasing("TikTok"),
  },
  {
    dependency: "goal→CTA-type benchmark",
    checkId: "cta_goal_mismatch",
    accessor: () => getGoalBenchmark("conversion"),
  },
];

for (const { dependency, checkId, accessor } of DEPENDENCIES) {
  Deno.test(`config populated: ${dependency} accessor resolves non-null`, () => {
    assertEquals(accessor() !== null, true);
  });

  Deno.test(`fallback: ${checkId} degrades to cannot_assess when ${dependency} is missing`, () => {
    const result = gateOnConfig(
      // Explicit null (not the live accessor): the gate contract must hold
      // whether or not the real table is populated.
      null,
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

Deno.test("getPlatformSpec resolves regardless of casing/whitespace", () => {
  const canonical = getPlatformSpec("TikTok");
  assertEquals(canonical !== null, true);
  // destination_platform arrives in varied casing from parsed_creative_briefs;
  // the lookup must still resolve to the same spec.
  assertEquals(getPlatformSpec("tiktok"), canonical);
  assertEquals(getPlatformSpec("  TIKTOK  "), canonical);
  assertEquals(getPlatformSpec("instagram reels") !== null, true);
  // A genuinely unmapped platform still returns null → gate stays cannot_assess.
  assertEquals(getPlatformSpec("Snapchat"), null);
});

Deno.test("getPlatformPhrasing resolves regardless of casing/whitespace", () => {
  const canonical = getPlatformPhrasing("TikTok");
  assertEquals(canonical !== null, true);
  // destination_platform arrives in varied casing from parsed_creative_briefs;
  // the lookup must still resolve to the same phrasing.
  assertEquals(getPlatformPhrasing("tiktok"), canonical);
  assertEquals(getPlatformPhrasing("  TIKTOK  "), canonical);
  assertEquals(getPlatformPhrasing("instagram reels") !== null, true);
  // A genuinely unmapped platform still returns null → gate stays cannot_assess.
  assertEquals(getPlatformPhrasing("Snapchat"), null);
});
