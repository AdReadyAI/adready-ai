/**
 * prompts.ts — Storyline agent prompt builders (Call 1 + Call 2).
 *
 * Wording follows the spec's two prompts, adapted to the AgentContext: the
 * narrative arc is labeled over point-in-time visual_frames, and pacing is judged
 * entirely by the model (there are no scene durations to sum). The hook window is
 * passed as a tunable default rather than hardcoded in prose. Functional first
 * drafts, expected to be tuned once Evaluation Science supplies numbers.
 */

import type { ChatMessage } from "../shared/llm_client.ts";
import type { AgentContext } from "../shared/schemas.ts";
import type { ArcLabeling } from "./response_schemas.ts";

/** Flat default hook window (ms); the spec expects this to vary by platform later. */
export const DEFAULT_HOOK_WINDOW_MS = 2500;

function derivationInput(ctx: AgentContext): string {
  return JSON.stringify(
    {
      duration_ms: ctx.video_metadata.duration_ms,
      visual_frames: ctx.visual_frames,
      transcript_segments: ctx.transcript_segments,
    },
    null,
    2,
  );
}

export function derivationPrompt(ctx: AgentContext): ChatMessage[] {
  const system =
    "You are labeling the narrative structure of a short-form ad. You are given the ordered visual_frames, each " +
    "with its timestamp_ms and a visual_description, plus the transcript_segments, and the total duration. Assign " +
    "every frame exactly one arc role from: hook, problem, solution, proof, payoff, cta, or detour. Use detour " +
    "for a frame that does not advance the story — an off-topic cutaway, a repeated beat, or filler. Judge the ad " +
    "against its own narrative; you are not given a brief and should not assume one. A role may go unfilled if no " +
    "frame plays it. Return only JSON with four fields. arc is an array of {frame_id, role, confidence}, where " +
    "confidence is high, medium, or low. unfilled_roles is the list of arc roles no frame filled. " +
    "payoff_resolved_at is the timestamp where the story resolves, or null if it never does. overall_confidence " +
    "is high, medium, or low for the labeling as a whole. Do not assess quality, do not assign severity, and do " +
    "not recommend fixes — that happens in the next step.";
  return [
    { role: "system", content: system },
    { role: "user", content: derivationInput(ctx) },
  ];
}

function evaluationInput(ctx: AgentContext, arc: ArcLabeling | null): string {
  return JSON.stringify(
    {
      duration_ms: ctx.video_metadata.duration_ms,
      destination_platform: ctx.destination_platform,
      visual_frames: ctx.visual_frames,
      transcript_segments: ctx.transcript_segments,
      hook_window_ms: DEFAULT_HOOK_WINDOW_MS,
      narrative_arc: arc, // null when Call 1 could not be labeled
    },
    null,
    2,
  );
}

const CREATIVE_EFFECTIVENESS_RUBRIC =
  "Severity rubric for creative_effectiveness (grade each sub-check against this, do not invent a scale). " +
  "hook_missing (range none→critical): none = strong hook in first 2s; low = hook resolves in 3–4s; " +
  "medium = generic/slow intro; high = first 2s unengaging or irrelevant; critical = actively off-putting. " +
  "narrative_gap (range none→high). value_prop_unclear (range none→medium). story_incomplete (range none→medium). " +
  "pacing_misallocation (range none→medium): judge whether the frames labeled detour take a disproportionate " +
  "share of the runtime.";

export function evaluationPrompt(
  ctx: AgentContext,
  arc: ArcLabeling | null,
): ChatMessage[] {
  const system =
    "You are evaluating the storyline clarity of a short-form ad against the creative_effectiveness metric. " +
    "You are given the visual_frames with their visual_descriptions and timestamps, the transcript_segments, " +
    "the total duration, the destination_platform, and the narrative arc labeled in the previous step (each " +
    "frame's arc role, which roles are unfilled, and where the payoff resolves). If narrative_arc is null the " +
    "labeling failed; judge only what the transcript and frames allow and use cannot_assess for arc-dependent " +
    "checks. You are not given a creative brief; judge the ad on its own internal coherence.\n\n" +
    "Run each of these sub-checks and report each separately: (1) hook_missing — does the opening hook_window_ms " +
    "establish a relevant, attention-grabbing hook? (2) narrative_gap — do the frames flow logically, or is there " +
    "a jump/contradiction/unrelated cut? (3) value_prop_unclear — would a viewer with no prior knowledge " +
    "understand what the product is and why it matters? (4) story_incomplete — does the arc resolve within the " +
    "runtime, using unfilled_roles and payoff_resolved_at, adjusting for very short ads? (5) pacing_misallocation " +
    "— using the frames labeled detour and their timestamps, judge whether the time they take is disproportionate " +
    "to the ad's length.\n\n" +
    CREATIVE_EFFECTIVENESS_RUBRIC +
    "\n\nReturn ONLY a single JSON object with these exact TOP-LEVEL keys and NO wrapper object around them: " +
    '"sub_checks" (array of { check_id, result: passed|failed|cannot_assess, severity: ' +
    "none|low|medium|high|critical, explanation (only when failed, naming the timestamp/frame) }), " +
    '"confidence" (high|medium|low), "evidence" (array of { type: transcript|ocr|visual|brief|metadata, text, ' +
    'timestamp }), "explanation", "suggested_correction" (a specific actionable fix), "correction_type". Do not ' +
    "nest confidence/evidence/explanation under any other key. Use cannot_assess when the inputs do not let you " +
    "judge a sub-check; do not guess and do not report a pass to fill a gap.";
  return [
    { role: "system", content: system },
    { role: "user", content: evaluationInput(ctx, arc) },
  ];
}
