/**
 * Agent-level tests for the Storyline Clarity Agent (agent.ts). The agent calls
 * `chat()` directly, so the LLM is stubbed hermetically via `withChat` (a scripted
 * globalThis.fetch — no network). Covers: exactly two calls, the LLM +
 * deterministic merge, severity clamping, rollup into two metric_results,
 * malformed-JSON degradation (Call 1 and Call 2), total LLM failure, and
 * sparse-context graceful degradation.
 */

import { assertEquals } from "@std/assert";
import {
  runStorylineAgent,
  type StorylineConfig,
} from "../../../functions/storyline-clarity-agent/agent.ts";
import { MetricResultSchema } from "../../../functions/shared/schemas.ts";
import type { MetricResult } from "../../../functions/shared/schemas.ts";
import { withChat, withChatFailure } from "../support/stub_chat.ts";
import { makeAgentContext } from "../support/fixtures.ts";

const POPULATED: StorylineConfig = {
  platformSpec: {
    allowed_aspect_ratios: ["9:16"],
    min_width: 1080,
    min_height: 1920,
    optimal_max_duration_ms: 30000,
    max_duration_ms: 60000,
  },
  arcExpectation: {
    expected_roles: ["hook", "problem", "payoff"],
    expect_payoff_resolved: true,
  },
};

const ARC_OK = JSON.stringify({
  arc: [
    { frame_id: "f1", role: "hook", confidence: "high" },
    { frame_id: "f2", role: "solution", confidence: "high" },
    { frame_id: "f3", role: "cta", confidence: "high" },
  ],
  unfilled_roles: ["problem"],
  payoff_resolved_at: "00:09",
  overall_confidence: "high",
});

// An arc that mechanically satisfies POPULATED.arcExpectation ([hook, problem,
// payoff] with the payoff resolved): every required role is labeled and
// payoff_resolved_at is non-null. Used to exercise the story_incomplete guardrail.
const ARC_COMPLETE = JSON.stringify({
  arc: [
    { frame_id: "f1", role: "hook", confidence: "high" },
    { frame_id: "f2", role: "problem", confidence: "high" },
    { frame_id: "f3", role: "payoff", confidence: "high" },
  ],
  unfilled_roles: [],
  payoff_resolved_at: "00:08",
  overall_confidence: "high",
});

function evalJson(
  subChecks: unknown[],
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

const ALL_PASS = evalJson([
  { check_id: "hook_missing", result: "passed", severity: "none" },
  { check_id: "narrative_gap", result: "passed", severity: "none" },
  { check_id: "value_prop_unclear", result: "passed", severity: "none" },
  { check_id: "story_incomplete", result: "passed", severity: "none" },
  { check_id: "pacing_misallocation", result: "passed", severity: "none" },
  { check_id: "placement_mismatch", result: "passed", severity: "none" },
]);

function metricsById(results: MetricResult[]) {
  return new Map(results.map((r) => [r.metric_id, r] as const));
}

function byResult(results: MetricResult[], id: string): string {
  return results.find((r) => r.metric_id === id)!.result;
}

Deno.test("returns exactly two metric_results, both schema-valid, in two calls", () =>
  withChat([ARC_OK, ALL_PASS], async (stub) => {
    const results = await runStorylineAgent(makeAgentContext(), POPULATED);
    assertEquals(results.length, 2);
    assertEquals(
      results.map((r) => r.metric_id).sort(),
      ["channel_readiness", "creative_effectiveness"],
    );
    for (const r of results) {
      assertEquals(MetricResultSchema.safeParse(r).success, true);
    }
    assertEquals(stub.callCount, 2);
  }));

Deno.test("happy path with populated config: both metrics pass", () =>
  withChat([ARC_OK, ALL_PASS], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const channel = byId.get("channel_readiness")!;
    assertEquals(channel.result, "true");
    assertEquals(channel.severity, "none");
    // channel_readiness rolls up the deterministic format check + the LLM placement check.
    assertEquals(channel.sub_checks!.map((s) => s.check_id).sort(), [
      "format_noncompliant",
      "placement_mismatch",
    ]);
    assertEquals(byId.get("creative_effectiveness")!.result, "true");
    assertEquals(byId.get("creative_effectiveness")!.severity, "none");
  }));

Deno.test("story_incomplete gates to cannot_assess when arcExpectation is null, even if the LLM graded it", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      {
        check_id: "story_incomplete",
        result: "failed",
        severity: "medium",
        explanation: "arc left unresolved",
      },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      { check_id: "placement_mismatch", result: "passed", severity: "none" },
    ]),
  ], async () => {
    const config: StorylineConfig = { ...POPULATED, arcExpectation: null };
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), config),
    );
    const story = byId.get("creative_effectiveness")!.sub_checks!.find(
      (s) => s.check_id === "story_incomplete",
    )!;
    assertEquals(story.result, "cannot_assess");
    assertEquals(story.severity, "cannot_assess");
  }));

Deno.test("story_incomplete over-fail is corrected to pass when the arc satisfies the expectation", () =>
  withChat([
    ARC_COMPLETE,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      // A genuine narrative_gap failure co-exists; the guardrail is surgical and
      // only touches story_incomplete, so creative_effectiveness still fails.
      {
        check_id: "narrative_gap",
        result: "failed",
        severity: "high",
        explanation: "Abrupt jump between frames.",
      },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      {
        check_id: "story_incomplete",
        result: "failed",
        severity: "medium",
        explanation: "Story feels thin; problem/solution not developed.",
      },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      { check_id: "placement_mismatch", result: "passed", severity: "none" },
    ]),
  ], async () => {
    // Dense fixture (3 frames / 10s → not sparse) + an arc that fills every
    // required role with the payoff resolved: the LLM's story_incomplete=failed is
    // a provable false positive and must be corrected to passed.
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const story = byId.get("creative_effectiveness")!.sub_checks!.find(
      (s) => s.check_id === "story_incomplete",
    )!;
    assertEquals(story.result, "passed");
    assertEquals(story.severity, "none");
    // The surgical correction leaves the genuine narrative_gap failure intact.
    assertEquals(byId.get("creative_effectiveness")!.result, "false");
  }));

Deno.test("story_incomplete guardrail does NOT manufacture a pass on sparse input", () =>
  withChat([
    ARC_COMPLETE,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      {
        check_id: "story_incomplete",
        result: "failed",
        severity: "medium",
        explanation: "Required role could not be observed.",
      },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      { check_id: "placement_mismatch", result: "passed", severity: "none" },
    ]),
  ], async () => {
    // Even with a satisfying arc, a 1-frame/10s context is sparse — the arc itself
    // is untrustworthy there, so the guardrail must not flip the failure to pass.
    const ctx = makeAgentContext({
      visual_frames: [
        { frame_id: "f1", timestamp_ms: 0, visual_description: "One frame." },
      ],
    });
    const byId = metricsById(await runStorylineAgent(ctx, POPULATED));
    const story = byId.get("creative_effectiveness")!.sub_checks!.find(
      (s) => s.check_id === "story_incomplete",
    )!;
    assertEquals(story.result, "failed");
  }));

Deno.test("story_incomplete failure stands when the arc does NOT satisfy the expectation", () =>
  withChat([
    // ARC_OK is missing 'problem' and 'payoff' roles → does not satisfy POPULATED.
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      {
        check_id: "story_incomplete",
        result: "failed",
        severity: "medium",
        explanation: "Required payoff role is unfilled.",
      },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      { check_id: "placement_mismatch", result: "passed", severity: "none" },
    ]),
  ], async () => {
    // The arc does not refute the failure (required roles genuinely unfilled), so
    // the guardrail leaves the LLM verdict untouched.
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const story = byId.get("creative_effectiveness")!.sub_checks!.find(
      (s) => s.check_id === "story_incomplete",
    )!;
    assertEquals(story.result, "failed");
    assertEquals(story.severity, "medium");
  }));

Deno.test("placement_mismatch failure rolls up into channel_readiness (format passes)", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      {
        check_id: "placement_mismatch",
        result: "failed",
        severity: "high",
        explanation: "Long-form talking-head pacing is wrong for TikTok.",
      },
    ]),
  ], async () => {
    // Format is spec-compliant (nominal fixture), so only placement fails.
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const channel = byId.get("channel_readiness")!;
    assertEquals(channel.result, "false");
    assertEquals(channel.severity, "high");
    assertEquals(
      channel.sub_checks!.find((s) => s.check_id === "placement_mismatch")!
        .severity,
      "high",
    );
    // A failing channel_readiness must carry metric-level evidence derived from
    // its own failed sub-check — persist.ts fills agent_result_evidence from it.
    assertEquals((channel.evidence?.length ?? 0) > 0, true);
    assertEquals(channel.correction_type, "edit_recommendation");
    // creative_effectiveness is unaffected by the channel-only failure.
    assertEquals(byId.get("creative_effectiveness")!.result, "true");
  }));

Deno.test("sparse input caps a placement failure to low with low confidence", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      {
        check_id: "placement_mismatch",
        result: "failed",
        severity: "high",
        explanation: "Only one frame; the ad looks static for TikTok.",
      },
    ]),
  ], async () => {
    // 1 visual frame over a 10s ad → sparse (isSparseAnalysis), so a model-returned
    // placement failed/high must be capped to low with the metric confidence low.
    const ctx = makeAgentContext({
      visual_frames: [
        { frame_id: "f1", timestamp_ms: 0, visual_description: "Static close-up." },
      ],
    });
    const byId = metricsById(await runStorylineAgent(ctx, POPULATED));
    const channel = byId.get("channel_readiness")!;
    const placement = channel.sub_checks!.find((s) =>
      s.check_id === "placement_mismatch"
    )!;
    assertEquals(placement.result, "failed");
    assertEquals(placement.severity, "low"); // capped from high
    assertEquals(channel.severity, "low");
    assertEquals(channel.confidence, "low");
  }));

Deno.test("placement_mismatch severity is clamped to high", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      // placement_mismatch max is "high" — model over-reports "critical".
      {
        check_id: "placement_mismatch",
        result: "failed",
        severity: "critical",
        explanation: "wrong platform",
      },
    ]),
  ], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const channel = byId.get("channel_readiness")!;
    assertEquals(
      channel.sub_checks!.find((s) => s.check_id === "placement_mismatch")!
        .severity,
      "high", // clamped down from critical
    );
    assertEquals(channel.severity, "high");
  }));

Deno.test("merge: deterministic format failure + LLM gap failure roll up per metric", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      {
        check_id: "narrative_gap",
        result: "failed",
        severity: "high",
        explanation: "Jump at 00:05.",
      },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
    ]),
  ], async () => {
    const ctx = makeAgentContext({
      video_metadata: {
        duration_ms: 10000,
        aspect_ratio: "16:9", // wrong for 9:16 spec → high
        resolution: "1920x1080",
        dropped_frame_markers: [],
        corruption_detected: false,
      },
    });
    const byId = metricsById(await runStorylineAgent(ctx, POPULATED));
    assertEquals(byId.get("channel_readiness")!.result, "false");
    assertEquals(byId.get("channel_readiness")!.severity, "high");
    assertEquals(byId.get("creative_effectiveness")!.result, "false");
    assertEquals(byId.get("creative_effectiveness")!.severity, "high");
  }));

Deno.test("severity clamp: an over-range LLM severity is capped to the sub-check's max", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      // value_prop_unclear max is "medium" — model over-reports "critical"
      {
        check_id: "value_prop_unclear",
        result: "failed",
        severity: "critical",
        explanation: "weak",
      },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
    ]),
  ], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const creative = byId.get("creative_effectiveness")!;
    const value = creative.sub_checks!.find((s) =>
      s.check_id === "value_prop_unclear"
    )!;
    assertEquals(value.severity, "medium"); // clamped down from critical
    assertEquals(creative.severity, "medium");
  }));

Deno.test("pacing_misallocation is LLM-judged: a Call-2 pacing failure rolls up", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      {
        check_id: "pacing_misallocation",
        result: "failed",
        severity: "medium",
        explanation: "Detour frames dominate.",
      },
    ]),
  ], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const creative = byId.get("creative_effectiveness")!;
    assertEquals(
      creative.sub_checks!.find((s) => s.check_id === "pacing_misallocation")!
        .severity,
      "medium",
    );
    assertEquals(creative.result, "false");
    assertEquals(creative.severity, "medium");
  }));

Deno.test("malformed Call 2 JSON: LLM sub-checks degrade to cannot_assess, no throw", () =>
  withChat([ARC_OK, "sorry, I cannot comply"], async (stub) => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const creative = byId.get("creative_effectiveness")!;
    const hook = creative.sub_checks!.find((s) =>
      s.check_id === "hook_missing"
    )!;
    assertEquals(hook.result, "cannot_assess");
    assertEquals(creative.confidence, "low");
    assertEquals(stub.callCount, 2);
  }));

Deno.test("malformed Call 1 JSON: arc lost, but Call 2 still runs and drives creative", () =>
  withChat(["not-json-arc", ALL_PASS], async (stub) => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const creative = byId.get("creative_effectiveness")!;
    // pacing is LLM-judged (not arc-gated), so Call 2's verdicts stand.
    assertEquals(
      creative.sub_checks!.find((s) => s.check_id === "pacing_misallocation")!
        .result,
      "passed",
    );
    assertEquals(
      creative.sub_checks!.find((s) => s.check_id === "hook_missing")!.result,
      "passed",
    );
    assertEquals(stub.callCount, 2);
  }));

Deno.test("total LLM failure: deterministic channel still stands, creative → cannot_assess", () =>
  withChatFailure(async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    // format check is deterministic and independent of the LLM → still passes.
    assertEquals(byId.get("channel_readiness")!.result, "true");
    assertEquals(byId.get("creative_effectiveness")!.result, "cannot_assess");
  }));

Deno.test("unmapped platform: channel judged on the LLM placement check", () =>
  withChat([ARC_OK, ALL_PASS], async () => {
    // No config arg → resolves from the global config surface. An unmapped
    // platform has no spec row, so getPlatformSpec returns null.
    const byId = metricsById(
      await runStorylineAgent(
        makeAgentContext({ destination_platform: "Snapchat" }),
      ),
    );
    const channel = byId.get("channel_readiness")!;
    // format_noncompliant gates off (null spec) → cannot_assess, but the LLM
    // placement_mismatch check is not config-gated and passes, so the metric stands.
    assertEquals(
      channel.sub_checks!.find((s) => s.check_id === "format_noncompliant")!
        .result,
      "cannot_assess",
    );
    assertEquals(channel.result, "true");
    // hook/narrative/value/pacing passed; story cannot_assess → judged on the passes.
    assertEquals(byId.get("creative_effectiveness")!.result, "true");
  }));

// --- correction_type normalization ------------------------------------------

Deno.test("correction_type: a passing creative_effectiveness is normalized to none, dropping any model correction", () =>
  withChat([
    ARC_OK,
    evalJson([
      { check_id: "hook_missing", result: "passed", severity: "none" },
      { check_id: "narrative_gap", result: "passed", severity: "none" },
      { check_id: "value_prop_unclear", result: "passed", severity: "none" },
      { check_id: "story_incomplete", result: "passed", severity: "none" },
      { check_id: "pacing_misallocation", result: "passed", severity: "none" },
      { check_id: "placement_mismatch", result: "passed", severity: "none" },
    ], {
      correction_type: "rewrite",
      suggested_correction: "punch up the hook",
    }),
  ], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const creative = byId.get("creative_effectiveness")!;
    assertEquals(creative.result, "true");
    assertEquals(creative.correction_type, "none");
    assertEquals(creative.suggested_correction, undefined);
  }));

Deno.test("partial reply: a failing creative_effectiveness with only sub_checks derives metric evidence/explanation and defaults correction_type", () =>
  withChat([
    ARC_OK,
    // A failing sub-check; the envelope omits evidence/explanation/correction_type.
    JSON.stringify({
      sub_checks: [
        { check_id: "hook_missing", result: "passed", severity: "none" },
        {
          check_id: "narrative_gap",
          result: "failed",
          severity: "high",
          explanation: "Hard cut at 00:05 breaks the flow.",
        },
        { check_id: "value_prop_unclear", result: "passed", severity: "none" },
        { check_id: "story_incomplete", result: "passed", severity: "none" },
        {
          check_id: "pacing_misallocation",
          result: "passed",
          severity: "none",
        },
        { check_id: "placement_mismatch", result: "passed", severity: "none" },
      ],
    }),
  ], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const creative = byId.get("creative_effectiveness")!;
    assertEquals(creative.result, "false");
    // Metric-level evidence/explanation are derived from the failed sub-check.
    assertEquals((creative.evidence?.length ?? 0) > 0, true);
    assertEquals(
      typeof creative.explanation === "string" &&
        creative.explanation.length > 0,
      true,
    );
    assertEquals(creative.correction_type, "edit_recommendation");
  }));

Deno.test("sparse context + all-cannot_assess LLM: two rows, graceful, no throw", () =>
  withChat([
    JSON.stringify({
      arc: [],
      unfilled_roles: [],
      payoff_resolved_at: null,
      overall_confidence: "low",
    }),
    evalJson([
      {
        check_id: "hook_missing",
        result: "cannot_assess",
        severity: "cannot_assess",
      },
      {
        check_id: "narrative_gap",
        result: "cannot_assess",
        severity: "cannot_assess",
      },
      {
        check_id: "value_prop_unclear",
        result: "cannot_assess",
        severity: "cannot_assess",
      },
      {
        check_id: "story_incomplete",
        result: "cannot_assess",
        severity: "cannot_assess",
      },
      {
        check_id: "pacing_misallocation",
        result: "cannot_assess",
        severity: "cannot_assess",
      },
    ], { confidence: "low" }),
  ], async () => {
    const sparse = makeAgentContext({
      destination_platform: "Snapchat",
      transcript_segments: [],
      visual_frames: [],
      ocr_segments: [],
    });
    // Unmapped platform (null spec) → the deterministic check gates off, and the
    // LLM abstains, so nothing is assessable — graceful cannot_assess, no fake pass.
    const results = await runStorylineAgent(sparse);
    assertEquals(results.length, 2);
    assertEquals(byResult(results, "channel_readiness"), "cannot_assess");
    assertEquals(byResult(results, "creative_effectiveness"), "cannot_assess");
  }));
