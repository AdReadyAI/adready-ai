/**
 * storyline-clarity-agent/index.ts — Storyline Clarity Agent Edge Function
 *
 * MAPPED METRICS:
 *   1. channel_readiness ("Is the video fully appropriate for the intended platform, placement, length, and viewing context?")
 *      - format_noncompliant: Aspect ratio, resolution, duration, or corruption failure
 *      - placement_mismatch: Fit for platform conventions, placement, and target audience
 *
 *   2. creative_effectiveness ("Does the ad have a clear hook, coherent message flow, and enough stopping power?")
 *      - hook_missing: Attention-grabbing visual or spoken hook absent in opening window
 *      - narrative_gap: Confusing jumps or cuts breaking narrative logic
 *      - value_prop_unclear: Core value proposition is weak or unstated
 *      - story_incomplete: Video cuts off before storyline arc finishes
 *      - pacing_misallocation: Too much runtime spent on detour beats
 *
 * ARCHITECTURE:
 *   Two-stage LLM evaluation pipeline. Call 1 derives the narrative arc over point-in-time
 *   visual frames. Call 2 evaluates qualitative sub-checks reading Call 1's output.
 *   Deterministic format checks evaluate arithmetic rules in code. Results roll up into two metric rows.
 */

import {
  createEvaluatorHandler,
  loadAgentContext,
  validateMetricResults,
} from "../shared/index.ts";

import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runStorylineAgent } from "./agent.ts";

createEvaluatorHandler(
  "storyline-clarity-agent",
  "storyline_clarity",
  AgentRunRequestSchema,
  async (ctx) => {
    const requestId = ctx.body.request_id;
    const context = await loadAgentContext(requestId);
    const results = await runStorylineAgent(context);
    return validateMetricResults(results);
  },
);
