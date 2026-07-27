/**
 * Cross-agent integration tests: the Storyline and CTA agents consuming the SAME
 * AgentContext, verifying the fixed-row-count contract that the Score Engine
 * relies on. Storyline always returns 2 metric_results, CTA always returns 1 —
 * exactly 3 of the scorecard's 10, with no id overlap and no dropped rows, even
 * on total LLM failure. The LLM is stubbed hermetically (scripted globalThis.fetch
 * via `withChat`); makes no real network/API call.
 */

import { assertEquals } from "@std/assert";
import { runStorylineAgent } from "../../../functions/storyline-clarity-agent/agent.ts";
import { runCtaAgent } from "../../../functions/cta-effectiveness-agent/agent.ts";
import { MetricResultSchema } from "../../../functions/shared/schemas.ts";
import { withChat, withChatFailure } from "../support/stub_chat.ts";
import { makeAgentContext } from "../support/fixtures.ts";

const ARC = JSON.stringify({
  arc: [
    { frame_id: "f1", role: "hook", confidence: "high" },
    { frame_id: "f2", role: "solution", confidence: "high" },
    { frame_id: "f3", role: "cta", confidence: "high" },
  ],
  unfilled_roles: [],
  payoff_resolved_at: "00:09",
  overall_confidence: "high",
});

const STORY_EVAL = JSON.stringify({
  sub_checks: [
    { check_id: "hook_missing", result: "passed", severity: "none" },
    { check_id: "narrative_gap", result: "passed", severity: "none" },
    { check_id: "value_prop_unclear", result: "passed", severity: "none" },
    { check_id: "story_incomplete", result: "passed", severity: "none" },
    { check_id: "pacing_misallocation", result: "passed", severity: "none" },
  ],
  confidence: "high",
  evidence: [],
  explanation: "Coherent.",
  suggested_correction: "",
  correction_type: "edit_recommendation",
});

const CTA_ACQ = JSON.stringify({
  ctas: [{
    text: "Try Mango Moon",
    source: "on_screen",
    start_ms: 8000,
    end_ms: 10000,
    explicit: true,
  }],
  cta_present: true,
  overall_confidence: "high",
});

const CTA_EVAL = JSON.stringify({
  sub_checks: [
    { check_id: "cta_absent", result: "passed", severity: "none" },
    { check_id: "cta_language_weak", result: "passed", severity: "none" },
    { check_id: "cta_goal_mismatch", result: "passed", severity: "none" },
    { check_id: "cta_no_urgency", result: "passed", severity: "none" },
    { check_id: "cta_destination_unclear", result: "passed", severity: "none" },
  ],
  confidence: "high",
  evidence: [],
  explanation: "Clear CTA.",
  suggested_correction: "",
  correction_type: "edit_recommendation",
});

Deno.test("both agents on one bundle → 3 distinct, schema-valid metric_results", () =>
  // The agents run sequentially, so one scripted queue feeds both (2 + 2 calls).
  withChat([ARC, STORY_EVAL, CTA_ACQ, CTA_EVAL], async (stub) => {
    const bundle = makeAgentContext();
    const story = await runStorylineAgent(bundle);
    const cta = await runCtaAgent(bundle);
    const results = [...story, ...cta];

    assertEquals(results.length, 3);
    assertEquals(
      results.map((r) => r.metric_id).sort(),
      ["channel_readiness", "creative_effectiveness", "cta_clarity"],
    );
    assertEquals(new Set(results.map((r) => r.metric_id)).size, 3); // distinct
    for (const r of results) {
      assertEquals(MetricResultSchema.safeParse(r).success, true);
    }
    assertEquals(stub.callCount, 4);
  }));

Deno.test("fixed row counts on total LLM failure — 2 + 1, never dropping a row", () =>
  withChatFailure(async () => {
    const bundle = makeAgentContext();
    const story = await runStorylineAgent(bundle);
    const cta = await runCtaAgent(bundle);

    assertEquals(story.length, 2);
    assertEquals(cta.length, 1);
    // Rows are still present and schema-valid even when every LLM call failed.
    for (const r of [...story, ...cta]) {
      assertEquals(MetricResultSchema.safeParse(r).success, true);
    }
  }));

Deno.test("no metric_id overlap between the two agents (3 of the scorecard's 10)", () =>
  withChat([ARC, STORY_EVAL, CTA_ACQ, CTA_EVAL], async () => {
    const bundle = makeAgentContext();
    const story = await runStorylineAgent(bundle);
    const cta = await runCtaAgent(bundle);

    const storyIds = new Set(story.map((r) => r.metric_id));
    for (const r of cta) assertEquals(storyIds.has(r.metric_id), false);
    assertEquals(story.length + cta.length, 3);
  }));
