/**
 * storyline-clarity-agent/index.ts — Storyline Clarity Agent
 *
 * Owned by: Kira Cho
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS (Mental Checklist):
 *
 *   1. channel_readiness ("Does the video fit the intended platform, placement, length, and viewing context?")
 *      [ ] format_noncompliant: Aspect ratio, resolution, or duration doesn't match platform spec limits.
 *
 *   2. creative_effectiveness ("Does the ad have a clear hook, coherent message flow, and enough stopping power?")
 *      [ ] hook_missing: Attention-grabbing visual or spoken hook absent in the opening 2-3 seconds.
 *      [ ] narrative_gap: Confusing jumps or cuts breaking narrative logic.
 *      [ ] value_prop_unclear: Core value proposition is weak or not stated clearly.
 *      [ ] story_incomplete: Video cuts off before the storyline arc finishes.
 *      [ ] pacing_misallocation: Too much runtime spent on detours vs driving story.
 *
 * DB CONTEXT:
 *   - Loads video metadata, transcript/OCR, visual frames, and platform context
 *     by request_id.
 *   - Uses frame-level visual context: `action`/`framing_composition`
 *     (replaces the old `visual_description`) plus deterministic shot/fade
 *     linkage (`shot_index`, `is_shot_start`, `is_fade`) for cut-adjacency
 *     without needing to re-derive it.
 *   - `video_metadata` now also carries shot/pacing structure (`shot_count`,
 *     `cuts_per_second`, `avg_shot_s`, `min_shot_s`, `max_shot_s`) and a
 *     `dynamism` label (`mostly_static`/`moderate`/`dynamic`) — deterministic
 *     signal directly relevant to pacing/narrative-gap checks, computed by
 *     the worker rather than needing to be inferred from raw frame captions.
 *
 * OUTPUT JSON STRUCTURE:
 *   [
 *     {
 *       "metric_id": "channel_readiness",
 *       "agent": "storyline_clarity",
 *       "metric_name": "Channel / Placement Readiness",
 *       "question": "Does the video fit the intended platform, placement, length, and viewing context?",
 *       "result": "false",
 *       "severity": "high",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "metadata",
 *           "text": "aspect_ratio: 16:9, platform: TikTok",
 *           "timestamp": ""
 *         }
 *       ],
 *       "explanation": "The video aspect ratio is horizontal (16:9) but the destination platform TikTok requires a vertical (9:16) format.",
 *       "suggested_correction": "Crop and reformat the video template to vertical 9:16.",
 *       "correction_type": "edit_recommendation",
 *       "sub_checks": [
 *         {
 *           "check_id": "format_noncompliant",
 *           "name": "Format Compliance",
 *           "result": "failed",
 *           "severity": "high",
 *           "explanation": "Landscape resolution 1920x1080 was submitted for TikTok placement."
 *         }
 *       ]
 *     },
 *     {
 *       "metric_id": "creative_effectiveness",
 *       "agent": "storyline_clarity",
 *       "metric_name": "Creative Effectiveness Basics",
 *       "question": "Does the ad have a clear hook, coherent message flow, and enough stopping power?",
 *       "result": "false",
 *       "severity": "low",
 *       "confidence": "medium",
 *       "evidence": [
 *         {
 *           "type": "visual",
 *           "text": "First 4 seconds show static title card with no action or spoken audio.",
 *           "timestamp": "00:00"
 *         }
 *       ],
 *       "explanation": "The video fails to establish an active visual or spoken hook within the first 2 seconds, showing a slow intro.",
 *       "suggested_correction": "Move the product-in-use action shot from 00:08 to the opening seconds of the video.",
 *       "correction_type": "edit_recommendation",
 *       "sub_checks": [
 *         {
 *           "check_id": "hook_missing",
 *           "name": "Hook Presence Check",
 *           "result": "failed",
 *           "severity": "low",
 *           "explanation": "Intro is a slow cinematic card that takes 4 seconds to resolve."
 *         },
 *         {
 *           "check_id": "narrative_gap",
 *           "name": "Narrative Gap Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "value_prop_unclear",
 *           "name": "Value Prop Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "story_incomplete",
 *           "name": "Story Completion",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "pacing_misallocation",
 *           "name": "Pacing Allocation",
 *           "result": "passed",
 *           "severity": "none"
 *         }
 *       ]
 *     }
 *   ]
 */

import { createEdgeHandler, ok } from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";
import { defaultLlmClient } from "../shared/llm_client.ts";
import { loadAgentContext } from "../shared/context.ts";
import { runStorylineAgent } from "./agent.ts";

// createEdgeHandler wraps CORS, auth, and AgentRunRequest validation. The agent
// loads its AgentContext from the DB by request_id (loadAgentContext is a stub
// until the context tables land), then always returns its two metric_results,
// degrading to cannot_assess rather than throwing.
createEdgeHandler(
  "storyline-clarity-agent",
  AgentRunRequestSchema,
  async (_req, ctx) => {
    const context = await loadAgentContext(ctx.body.request_id, undefined, {
      userId: ctx.user.id,
    });
    const results = await runStorylineAgent(context, defaultLlmClient);
    return ok(results);
  },
);
