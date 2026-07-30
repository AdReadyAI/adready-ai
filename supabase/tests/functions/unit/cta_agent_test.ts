/**
 * Agent-level tests for the CTA Effectiveness Agent (agent.ts). The agent calls
 * `chat()` directly, so the LLM is stubbed hermetically via `withChat` (a scripted
 * globalThis.fetch — no network). Covers: exactly two calls / one metric_result,
 * the goal-conditional cta_absent table across all four goals, cta_no_urgency
 * goal-scoping across all four goals, the LLM + deterministic merge, the "no false
 * critical" implicit-CTA path, malformed-JSON degradation (Call 1 and Call 2), and
 * sparse graceful degradation.
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
import { withChat } from "../support/stub_chat.ts";
import { makeAgentContext } from "../support/fixtures.ts";

const UNPOPULATED: CtaConfig = {
  timing: null,
  visibility: null,
  phrasing: null,
  goalBenchmarkPresent: false,
};

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

Deno.test("returns exactly one metric_result (cta_clarity), schema-valid, in two calls", () =>
  withChat([acq(true, PRESENT_CTA), evl()], async (stub) => {
    const results = await runCtaAgent(makeAgentContext(), POPULATED);
    assertEquals(results.length, 1);
    assertEquals(results[0].metric_id, "cta_clarity");
    assertEquals(MetricResultSchema.safeParse(results[0]).success, true);
    assertEquals(stub.callCount, 2);
  }));

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
  Deno.test(`cta_absent: absent CTA on ${goal} → severity ${ABSENT_SEVERITY[goal]}`, () =>
    // Call 1 confirms no CTA; deterministic checks see no acquired CTAs.
    withChat([acq(false, []), evl()], async () => {
      const ctx = makeAgentContext({ campaign_goal: goal, ocr_segments: [] });
      const [result] = await runCtaAgent(ctx, POPULATED);
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
    }));
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
  Deno.test(`cta_no_urgency: only fires on conversion (goal=${goal})`, () =>
    // Model reports NO urgency (failed/low). It must be honored only on conversion.
    withChat([
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
    ], async () => {
      const ctx = makeAgentContext({ campaign_goal: goal });
      const [result] = await runCtaAgent(ctx, POPULATED);
      const urgency = sub(result, "cta_no_urgency");
      if (goal === "conversion") {
        assertEquals(urgency.result, "failed");
        assertEquals(urgency.severity, "low");
      } else {
        assertEquals(urgency.result, "passed"); // goal-scoped: forced pass off-conversion
        assertEquals(urgency.severity, "none");
      }
    }));
}

// --- merge, implicit CTA, degradation ---------------------------------------

Deno.test("merge: deterministic cta_buried (high) + LLM cta_language_weak (medium) roll up worst-wins", () =>
  // Call 1 returns a single CTA entirely in the opening window → buried (high).
  withChat([
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
  ], async () => {
    const [result] = await runCtaAgent(
      makeAgentContext({ ocr_segments: [] }),
      POPULATED,
    );
    assertEquals(sub(result, "cta_buried").severity, "high");
    assertEquals(sub(result, "cta_language_weak").severity, "medium");
    assertEquals(result.result, "false");
    assertEquals(result.severity, "high");
  }));

Deno.test("no false critical: Call 1 finds an implicit CTA on conversion", () =>
  withChat([
    acq(true, [{
      text: "mangomoon.com on end card",
      source: "visual",
      start_ms: 9000,
      end_ms: 10000,
      explicit: false,
    }]),
    evl(),
  ], async () => {
    const ctx = makeAgentContext({
      campaign_goal: "conversion",
      ocr_segments: [],
    });
    const [result] = await runCtaAgent(ctx, POPULATED);
    // Absence must NOT be reported — Call 1 saw a CTA.
    assertEquals(sub(result, "cta_absent").result, "passed");
    assertEquals(result.severity !== "critical", true);
  }));

Deno.test("malformed Call 2: LLM checks cannot_assess, but cta_absent still stands from Call 1", () =>
  withChat([acq(true, PRESENT_CTA), "not json at all"], async (stub) => {
    const [result] = await runCtaAgent(makeAgentContext(), POPULATED);
    assertEquals(sub(result, "cta_language_weak").result, "cannot_assess");
    assertEquals(sub(result, "cta_absent").result, "passed"); // presence came from Call 1
    assertEquals(result.confidence, "low");
    assertEquals(stub.callCount, 2);
  }));

Deno.test("malformed Call 1: cta_absent falls back to the Call 2 presence verdict", () =>
  withChat(["broken-json", evl()], async (stub) => {
    // Call 2 cta_absent = passed → present
    const [result] = await runCtaAgent(makeAgentContext(), POPULATED);
    assertEquals(sub(result, "cta_absent").result, "passed");
    assertEquals(stub.callCount, 2);
  }));

// --- correction_type normalization ------------------------------------------

Deno.test("correction_type: a passing cta_clarity is normalized to none, dropping any model correction", () =>
  // Awareness + no CTA → cta_absent passes and every other check passes → true.
  withChat([
    acq(false, []),
    evl(PASS_CHECKS, {
      correction_type: "rewrite",
      suggested_correction: "tighten the CTA",
    }),
  ], async () => {
    const ctx = makeAgentContext({
      campaign_goal: "awareness",
      ocr_segments: [],
    });
    const [result] = await runCtaAgent(ctx, POPULATED);
    assertEquals(result.result, "true");
    assertEquals(result.correction_type, "none");
    assertEquals(result.suggested_correction, undefined);
  }));

Deno.test("partial reply: a failing cta_clarity with only sub_checks derives metric evidence/explanation and defaults correction_type", () =>
  withChat([
    acq(true, PRESENT_CTA),
    // A failing sub-check; the envelope omits evidence/explanation/correction_type.
    JSON.stringify({
      sub_checks: [
        { check_id: "cta_absent", result: "passed", severity: "none" },
        {
          check_id: "cta_language_weak",
          result: "failed",
          severity: "medium",
          explanation: "Vague 'Check us out' at 00:08.",
        },
        { check_id: "cta_goal_mismatch", result: "passed", severity: "none" },
        { check_id: "cta_no_urgency", result: "passed", severity: "none" },
        {
          check_id: "cta_destination_unclear",
          result: "passed",
          severity: "none",
        },
      ],
    }),
  ], async () => {
    const ctx = makeAgentContext({ ocr_segments: [] });
    const [result] = await runCtaAgent(ctx, POPULATED);
    assertEquals(result.result, "false");
    // Metric-level evidence/explanation are derived from the failed sub-check so
    // the failure is never persisted evidence-less (agent_result_evidence reads
    // only from metric.evidence).
    assertEquals((result.evidence?.length ?? 0) > 0, true);
    assertEquals(
      typeof result.explanation === "string" && result.explanation.length > 0,
      true,
    );
    // A real failure keeps a correction type (missing → edit_recommendation).
    assertEquals(result.correction_type, "edit_recommendation");
  }));

Deno.test("sparse: both calls malformed + unpopulated config → single cannot_assess row, no throw", () =>
  withChat(["nope", "nope"], async () => {
    const ctx = makeAgentContext({
      campaign_goal: "conversion",
      ocr_segments: [],
    });
    // Explicit unpopulated config → the degraded path, independent of whether
    // the global config surface has since been populated.
    const results = await runCtaAgent(ctx, UNPOPULATED);
    assertEquals(results.length, 1);
    assertEquals(results[0].result, "cannot_assess");
  }));
