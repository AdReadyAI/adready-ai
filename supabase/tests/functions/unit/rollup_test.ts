/**
 * Unit tests for the shared metric rollup (_evaluator/rollup.ts).
 *
 * Pure logic, no services, no network. Covers worst-wins across sub-checks,
 * all-cannot_assess → metric cannot_assess, mixed cannot_assess/assessable
 * (judged on the assessable ones), the single-sub-check trivial rollup, and
 * strategy swappability.
 */

import { assertEquals } from "@std/assert";
import {
  rollupMetric,
  type RollupStrategy,
  worstWinsRollup,
} from "../../../functions/_evaluator/rollup.ts";
import type {
  SeverityLevel,
  SubCheckResult,
} from "../../../functions/shared/schemas.ts";

/** Terse sub-check builder for tests. */
function sub(
  result: SubCheckResult["result"],
  severity: SeverityLevel,
  check_id = "check",
): SubCheckResult {
  return { check_id, name: check_id, result, severity };
}

Deno.test("passes: all sub-checks passed → true / none", () => {
  const out = rollupMetric([sub("passed", "none"), sub("passed", "none")]);
  assertEquals(out, { result: "true", severity: "none" });
});

Deno.test("fails: one failed among passed → false, mirrors the failure severity", () => {
  const out = rollupMetric([sub("passed", "none"), sub("failed", "high")]);
  assertEquals(out, { result: "false", severity: "high" });
});

Deno.test("worst-wins: severity is the max across failed sub-checks", () => {
  const out = rollupMetric([
    sub("failed", "low"),
    sub("failed", "critical"),
    sub("failed", "medium"),
  ]);
  assertEquals(out, { result: "false", severity: "critical" });
});

Deno.test("worst-wins does NOT escalate on breadth (documents the known v1 limit)", () => {
  // Four mediums are materially worse than one, but worst-wins caps at medium.
  const four = rollupMetric([
    sub("failed", "medium"),
    sub("failed", "medium"),
    sub("failed", "medium"),
    sub("failed", "medium"),
  ]);
  const one = rollupMetric([sub("failed", "medium")]);
  assertEquals(four, one);
  assertEquals(four.severity, "medium");
});

Deno.test("all cannot_assess → metric cannot_assess", () => {
  const out = rollupMetric([
    sub("cannot_assess", "cannot_assess"),
    sub("cannot_assess", "cannot_assess"),
  ]);
  assertEquals(out, { result: "cannot_assess", severity: "cannot_assess" });
});

Deno.test("empty sub-check list → cannot_assess (degenerate case)", () => {
  assertEquals(rollupMetric([]), {
    result: "cannot_assess",
    severity: "cannot_assess",
  });
});

Deno.test("mixed cannot_assess + all-passed assessable → judged on the assessable → true", () => {
  const out = rollupMetric([
    sub("cannot_assess", "cannot_assess"),
    sub("passed", "none"),
  ]);
  assertEquals(out, { result: "true", severity: "none" });
});

Deno.test("mixed cannot_assess + one failed → judged on the assessable → false", () => {
  const out = rollupMetric([
    sub("cannot_assess", "cannot_assess"),
    sub("passed", "none"),
    sub("failed", "medium"),
  ]);
  assertEquals(out, { result: "false", severity: "medium" });
});

Deno.test("single sub-check: metric mirrors it (channel_readiness trivial rollup)", () => {
  assertEquals(
    rollupMetric([sub("failed", "critical", "format_noncompliant")]),
    {
      result: "false",
      severity: "critical",
    },
  );
  assertEquals(rollupMetric([sub("passed", "none", "format_noncompliant")]), {
    result: "true",
    severity: "none",
  });
  assertEquals(
    rollupMetric([
      sub("cannot_assess", "cannot_assess", "format_noncompliant"),
    ]),
    {
      result: "cannot_assess",
      severity: "cannot_assess",
    },
  );
});

Deno.test("strategy is swappable: rollupMetric delegates to the injected rule", () => {
  let calls = 0;
  const stub: RollupStrategy = (subChecks) => {
    calls++;
    // A breadth-escalating rule Eval Science might supply: 2+ mediums → high.
    const mediums = subChecks.filter((c) =>
      c.result === "failed" && c.severity === "medium"
    );
    return {
      result: "false",
      severity: mediums.length >= 2 ? "high" : "medium",
    };
  };
  const out = rollupMetric(
    [sub("failed", "medium"), sub("failed", "medium")],
    stub,
  );
  assertEquals(calls, 1);
  assertEquals(out.severity, "high");
});

Deno.test("worstWinsRollup is exported as the default rule and is referentially usable", () => {
  assertEquals(worstWinsRollup([sub("passed", "none")]), {
    result: "true",
    severity: "none",
  });
});
