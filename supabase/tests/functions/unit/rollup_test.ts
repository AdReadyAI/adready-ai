/**
 * Unit tests for the worst-wins metric rollup.
 *
 * Both agents share the one `rollupChecks` in shared/checks.ts. Pure logic,
 * no services, no network. Covers worst-wins across sub-checks, all-cannot_assess
 * → metric cannot_assess, mixed cannot_assess/assessable (judged on the
 * assessable ones), and the single-sub-check trivial rollup.
 */

import { assertEquals } from "@std/assert";
import { rollupChecks as rollup } from "../../../functions/shared/checks.ts";
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
  const out = rollup([sub("passed", "none"), sub("passed", "none")]);
  assertEquals(out, { result: "true", severity: "none" });
});

Deno.test("fails: one failed among passed → false, mirrors the failure severity", () => {
  const out = rollup([sub("passed", "none"), sub("failed", "high")]);
  assertEquals(out, { result: "false", severity: "high" });
});

Deno.test("worst-wins: severity is the max across failed sub-checks", () => {
  const out = rollup([
    sub("failed", "low"),
    sub("failed", "critical"),
    sub("failed", "medium"),
  ]);
  assertEquals(out, { result: "false", severity: "critical" });
});

Deno.test("worst-wins does NOT escalate on breadth (documents the known v1 limit)", () => {
  // Four mediums are materially worse than one, but worst-wins caps at medium.
  const four = rollup([
    sub("failed", "medium"),
    sub("failed", "medium"),
    sub("failed", "medium"),
    sub("failed", "medium"),
  ]);
  const one = rollup([sub("failed", "medium")]);
  assertEquals(four, one);
  assertEquals(four.severity, "medium");
});

Deno.test("all cannot_assess → metric cannot_assess", () => {
  const out = rollup([
    sub("cannot_assess", "cannot_assess"),
    sub("cannot_assess", "cannot_assess"),
  ]);
  assertEquals(out, { result: "cannot_assess", severity: "cannot_assess" });
});

Deno.test("empty sub-check list → cannot_assess (degenerate case)", () => {
  assertEquals(rollup([]), {
    result: "cannot_assess",
    severity: "cannot_assess",
  });
});

Deno.test("mixed cannot_assess + all-passed assessable → judged on the assessable → true", () => {
  const out = rollup([
    sub("cannot_assess", "cannot_assess"),
    sub("passed", "none"),
  ]);
  assertEquals(out, { result: "true", severity: "none" });
});

Deno.test("mixed cannot_assess + one failed → judged on the assessable → false", () => {
  const out = rollup([
    sub("cannot_assess", "cannot_assess"),
    sub("passed", "none"),
    sub("failed", "medium"),
  ]);
  assertEquals(out, { result: "false", severity: "medium" });
});

Deno.test("single sub-check: metric mirrors it (channel_readiness trivial rollup)", () => {
  assertEquals(
    rollup([sub("failed", "critical", "format_noncompliant")]),
    { result: "false", severity: "critical" },
  );
  assertEquals(rollup([sub("passed", "none", "format_noncompliant")]), {
    result: "true",
    severity: "none",
  });
  assertEquals(
    rollup([sub("cannot_assess", "cannot_assess", "format_noncompliant")]),
    { result: "cannot_assess", severity: "cannot_assess" },
  );
});
