/**
 * cta-effectiveness-agent/index.ts — Call to Action (CTA) Effectiveness Agent
 *
 * MAPPED METRIC:
 *   - cta_clarity ("Is there a clear and appropriate next step for the viewer?")
 *
 * SUB-CHECKS (9 total):
 *   Deterministic (Config-gated):
 *     - cta_buried: CTA appears only in opening seconds and never repeats at close
 *     - cta_mistimed: CTA does not land in closing portion of runtime or dwells too briefly
 *     - cta_low_visibility: On-screen CTA region or font size below legibility threshold
 *     - cta_platform_mismatch: CTA phrasing violates platform conventions
 *   LLM Evaluated (Two-call pipeline):
 *     - cta_absent: Presence from Call 1 acquisition, severity goal-conditional
 *     - cta_language_weak: Phrasing is passive or vague rather than action-oriented
 *     - cta_goal_mismatch: CTA type clashes with campaign goal benchmark
 *     - cta_no_urgency: Conversion-goal CTA lacks time-pressure or incentive cues
 *     - cta_destination_unclear: Destination (site, store, app) not specified
 *
 * ARCHITECTURE:
 *   Two-stage LLM evaluation pipeline. Call 1 derives canonical CTA occurrences with
 *   numeric timestamps from transcript and OCR segments. Call 2 evaluates qualitative
 *   sub-checks against campaign goal benchmarks. Deterministic checks evaluate arithmetic
 *   rules in code. Results roll up worst-wins into cta_clarity.
 */

import {
  createInternalEdgeHandler,
  loadAgentContext,
  ok,
  persistMetricResults,
  validateMetricResults,
} from "../shared/index.ts";

import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runCtaAgent } from "./agent.ts";

createInternalEdgeHandler(
  "cta-effectiveness-agent",
  AgentRunRequestSchema,
  async (_req, ctx) => {
    const requestId = ctx.body.request_id;
    const context = await loadAgentContext(requestId);
    const results = await runCtaAgent(context);
    const validated = validateMetricResults(results);

    await persistMetricResults(requestId, validated);

    return ok(validated);
  },
);
