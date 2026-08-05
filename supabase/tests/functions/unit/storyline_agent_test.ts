/**
 * Agent-level tests for the Storyline Clarity Agent (agent.ts).
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

function unifiedJson(
  subChecks: unknown[],
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    arc: [
      { frame_id: "vf_001", role: "hook", confidence: "high" },
      { frame_id: "vf_002", role: "solution", confidence: "high" },
      { frame_id: "vf_003", role: "cta", confidence: "high" },
    ],
    unfilled_roles: ["problem"],
    payoff_resolved_at: 9000,
    overall_confidence: "high",
    sub_checks: subChecks,
    confidence: "high",
    evidence: [],
    explanation: "ok",
    suggested_correction: "",
    correction_type: "edit_recommendation",
    ...extra,
  });
}

const UNIFIED_ALL_PASS = unifiedJson([
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

Deno.test("returns exactly two metric_results, both schema-valid, in a single call", () =>
  withChat([UNIFIED_ALL_PASS], async (stub) => {
    const results = await runStorylineAgent(makeAgentContext(), POPULATED);
    assertEquals(results.length, 2);
    assertEquals(
      results.map((r) => r.metric_id).sort(),
      ["channel_readiness", "creative_effectiveness"],
    );
    for (const r of results) {
      assertEquals(MetricResultSchema.safeParse(r).success, true);
    }
    assertEquals(stub.callCount, 1);
  }));

Deno.test("happy path with populated config: both metrics pass", () =>
  withChat([UNIFIED_ALL_PASS], async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    const channel = byId.get("channel_readiness")!;
    assertEquals(channel.result, "true");
    assertEquals(channel.severity, "none");
    assertEquals(channel.sub_checks!.map((s) => s.check_id).sort(), [
      "format_noncompliant",
      "placement_mismatch",
    ]);
    assertEquals(byId.get("creative_effectiveness")!.result, "true");
    assertEquals(byId.get("creative_effectiveness")!.severity, "none");
  }));

Deno.test("total LLM failure: deterministic channel stands, creative degrades to cannot_assess", () =>
  withChatFailure(async () => {
    const byId = metricsById(
      await runStorylineAgent(makeAgentContext(), POPULATED),
    );
    assertEquals(byId.get("channel_readiness")!.result, "true");
    assertEquals(byId.get("creative_effectiveness")!.result, "cannot_assess");
  }));
