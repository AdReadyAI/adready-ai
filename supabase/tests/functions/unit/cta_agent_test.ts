/**
 * Agent-level tests for the CTA Effectiveness Agent (agent.ts) with a scripted
 * LLM. Covers: exactly two calls / one metric_result, the goal-conditional
 * cta_absent table across all four goals, cta_no_urgency goal-scoping across all
 * four goals, the LLM + deterministic merge, the "no false critical" implicit-CTA
 * path, malformed-JSON degradation (Call 1 and Call 2), and sparse graceful
 * degradation. No network.
 */

import { assertEquals } from "@std/assert";
import {
  type CtaConfig,
  runCtaAgent,
} from "../../../functions/cta-effectiveness-agent/agent.ts";
import { MetricResultSchema } from "../../../functions/shared/schemas.ts";
import type {
  MetricResult,
  SubCheckResult,
} from "../../../functions/shared/schemas.ts";
import { scriptedLlm } from "../support/mock_llm.ts";
import { makeAgentContext } from "../support/fixtures.ts";

const POPULATED: CtaConfig = {
  timing: {
    buried_window_ms: 5000,
    landing_zone_start_fraction: 0.7,
    landing_zone_end_fraction: 1.0,
    min_dwell_ms: 1000,
  },
  visibility: {
    min_region_size: 1000,
    marginal_region_size: 2000,
    min_font_size_px: 20,
    marginal_font_size_px: 32,
  },
  phrasing: { discouraged_phrases: ["swipe up"] },
  goalBenchmarkPresent: true,
};

function acq(present: boolean, ctas: unknown[] = []): string {
  return JSON.stringify({
    ctas,
    cta_present: present,
    overall_confidence: "high",
  });
}

const PRESENT_CTA = [{
  text: "Try Mango Moon",
  source: "on_screen",
  start_ms: 8000,
  end_ms: 10000,
  explicit: true,
}];

const PASS_CHECKS = [
  { check_id: "cta_absent", result: "passed", severity: "none" },
  { check_id: "cta_language_weak", result: "passed", severity: "none" },
  { check_id: "cta_goal_mismatch", result: "passed", severity: "none" },
  { check_id: "cta_no_urgency", result: "passed", severity: "none" },
  { check_id: "cta_destination_unclear", result: "passed", severity: "none" },
];

function evl(
  subChecks: unknown[] = PASS_CHECKS,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    sub_checks: subChecks,
    confidence: "high",
    evidence: [],
    explanation: "ok",
    suggested_correction: "",
    correction_type: "edit_recommendation",
    ...extra,
  });
}

function sub(result: MetricResult, id: string): SubCheckResult {
  return result.sub_checks!.find((s) => s.check_id === id)!;
}

Deno.test("returns exactly one metric_result (cta_clarity), schema-valid, in two calls", async () => {
  const llm = scriptedLlm([acq(true, PRESENT_CTA), evl()]);
  const results = await runCtaAgent(makeAgentContext(), llm, POPULATED);
  assertEquals(results.length, 1);
  assertEquals(results[0].metric_id, "cta_clarity");
  assertEquals(MetricResultSchema.safeParse(results[0]).success, true);
  assertEquals(llm.callCount, 2);
});

// --- cta_absent goal-conditional severity (all four goals) -------------------

const ABSENT_SEVERITY: Record<string, string> = {
  awareness: "none",
  consideration: "medium",
  repurchase: "high",
  conversion: "critical",
};

for (
  const goal of [
    "awareness",
    "consideration",
    "repurchase",
    "conversion",
  ] as const
) {
  Deno.test(`cta_absent: absent CTA on ${goal} → severity ${ABSENT_SEVERITY[goal]}`, async () => {
    // Call 1 confirms no CTA; deterministic checks see no acquired CTAs.
    const llm = scriptedLlm([acq(false, []), evl()]);
    const ctx = makeAgentContext({ campaign_goal: goal, ocr_segments: [] });
    const [result] = await runCtaAgent(ctx, llm, POPULATED);
    const absent = sub(result, "cta_absent");
    if (goal === "awareness") {
      assertEquals(absent.result, "passed"); // a CTA is optional on awareness
      assertEquals(result.result, "true");
    } else {
      assertEquals(absent.result, "failed");
      assertEquals(absent.severity, ABSENT_SEVERITY[goal]);
      assertEquals(result.result, "false");
      assertEquals(result.severity, ABSENT_SEVERITY[goal]);
    }
  });
}

// --- cta_no_urgency goal-scoping (all four goals) ----------------------------

for (
  const goal of [
    "awareness",
    "consideration",
    "repurchase",
    "conversion",
  ] as const
) {
  Deno.test(`cta_no_urgency: only fires on conversion (goal=${goal})`, async () => {
    // Model reports NO urgency (failed/low). It must be honored only on conversion.
    const llm = scriptedLlm([
      acq(true, PRESENT_CTA),
      evl([
        { check_id: "cta_absent", result: "passed", severity: "none" },
        { check_id: "cta_language_weak", result: "passed", severity: "none" },
        { check_id: "cta_goal_mismatch", result: "passed", severity: "none" },
        {
          check_id: "cta_no_urgency",
          result: "failed",
          severity: "low",
          explanation: "No urgency cue.",
        },
        {
          check_id: "cta_destination_unclear",
          result: "passed",
          severity: "none",
        },
      ]),
    ]);
    const ctx = makeAgentContext({ campaign_goal: goal });
    const [result] = await runCtaAgent(ctx, llm, POPULATED);
    const urgency = sub(result, "cta_no_urgency");
    if (goal === "conversion") {
      assertEquals(urgency.result, "failed");
      assertEquals(urgency.severity, "low");
    } else {
      assertEquals(urgency.result, "passed"); // goal-scoped: forced pass off-conversion
      assertEquals(urgency.severity, "none");
    }
  });
}

// --- merge, implicit CTA, degradation ---------------------------------------

Deno.test("merge: deterministic cta_buried (high) + LLM cta_language_weak (medium) roll up worst-wins", async () => {
  // Call 1 returns a single CTA entirely in the opening window → buried (high).
  const llm = scriptedLlm([
    acq(true, [{
      text: "Buy",
      source: "on_screen",
      start_ms: 1000,
      end_ms: 2500,
      explicit: true,
    }]),
    evl([
      { check_id: "cta_absent", result: "passed", severity: "none" },
      {
        check_id: "cta_language_weak",
        result: "failed",
        severity: "medium",
        explanation: "Vague.",
      },
      { check_id: "cta_goal_mismatch", result: "passed", severity: "none" },
      { check_id: "cta_no_urgency", result: "passed", severity: "none" },
      {
        check_id: "cta_destination_unclear",
        result: "passed",
        severity: "none",
      },
    ]),
  ]);
  const [result] = await runCtaAgent(
    makeAgentContext({ ocr_segments: [] }),
    llm,
    POPULATED,
  );
  assertEquals(sub(result, "cta_buried").severity, "high");
  assertEquals(sub(result, "cta_language_weak").severity, "medium");
  assertEquals(result.result, "false");
  assertEquals(result.severity, "high");
});

Deno.test("no false critical: Call 1 finds an implicit CTA on conversion", async () => {
  const implicit = [{
    text: "mangomoon.com on end card",
    source: "visual",
    start_ms: 9000,
    end_ms: 10000,
    explicit: false,
  }];
  const llm = scriptedLlm([acq(true, implicit), evl()]);
  const ctx = makeAgentContext({
    campaign_goal: "conversion",
    ocr_segments: [],
  });
  const [result] = await runCtaAgent(ctx, llm, POPULATED);
  // Absence must NOT be reported — Call 1 saw a CTA.
  assertEquals(sub(result, "cta_absent").result, "passed");
  assertEquals(result.severity !== "critical", true);
});

Deno.test("malformed Call 2: LLM checks cannot_assess, but cta_absent still stands from Call 1", async () => {
  const llm = scriptedLlm([acq(true, PRESENT_CTA), "not json at all"]);
  const [result] = await runCtaAgent(makeAgentContext(), llm, POPULATED);
  assertEquals(sub(result, "cta_language_weak").result, "cannot_assess");
  assertEquals(sub(result, "cta_absent").result, "passed"); // presence came from Call 1
  assertEquals(result.confidence, "low");
  assertEquals(llm.callCount, 2);
});

Deno.test("malformed Call 1: cta_absent falls back to the Call 2 presence verdict", async () => {
  const llm = scriptedLlm(["broken-json", evl()]); // Call 2 cta_absent = passed → present
  const [result] = await runCtaAgent(makeAgentContext(), llm, POPULATED);
  assertEquals(sub(result, "cta_absent").result, "passed");
  assertEquals(llm.callCount, 2);
});

Deno.test("sparse: both calls malformed + unpopulated config → single cannot_assess row, no throw", async () => {
  const llm = scriptedLlm(["nope", "nope"]);
  const ctx = makeAgentContext({
    campaign_goal: "conversion",
    ocr_segments: [],
  });
  // No config arg → resolves from the null global config surface.
  const results = await runCtaAgent(ctx, llm);
  assertEquals(results.length, 1);
  assertEquals(results[0].result, "cannot_assess");
});
