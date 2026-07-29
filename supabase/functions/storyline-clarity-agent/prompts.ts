/**
 * prompts.ts — Storyline agent prompt builders (Call 1 + Call 2).
 *
 * Wording follows the spec's two prompts, adapted to the AgentContext: the
 * narrative arc is labeled over point-in-time visual_frames, and pacing is judged
 * entirely by the model (there are no scene durations to sum). Call 2 also judges
 * placement_mismatch — the channel_readiness appropriateness check — using the
 * destination_platform, campaign_goal, and audience_brief evidence. The hook
 * window is passed as a tunable default rather than hardcoded in prose. Functional
 * first drafts, expected to be tuned once Evaluation Science supplies numbers.
 */

import type { ChatMessage } from "../shared/llm.ts";
import type { AgentContext } from "../shared/schemas.ts";
import type { ArcExpectation } from "./config.ts";
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

function evaluationInput(
  ctx: AgentContext,
  arc: ArcLabeling | null,
  arcExpectation: ArcExpectation | null,
): string {
  const brief = ctx.parsed_creative_brief;
  return JSON.stringify(
    {
      duration_ms: ctx.video_metadata.duration_ms,
      destination_platform: ctx.destination_platform,
      campaign_goal: ctx.campaign_goal,
      // Audience-brief evidence for placement_mismatch; any field may be null.
      audience_brief: {
        target_audience: brief.target_audience ?? null,
        brand_voice: brief.brand_voice ?? null, // tone
        required_messages: brief.required_messages,
      },
      visual_frames: ctx.visual_frames,
      transcript_segments: ctx.transcript_segments,
      hook_window_ms: DEFAULT_HOOK_WINDOW_MS,
      narrative_arc: arc, // null when Call 1 could not be labeled
      // Duration-bucket bar for story_incomplete; null → return cannot_assess for it.
      arc_expectation: arcExpectation
        ? {
          required_arc_roles: arcExpectation.expected_roles,
          payoff_must_resolve_within_runtime:
            arcExpectation.expect_payoff_resolved,
        }
        : null,
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

const CHANNEL_READINESS_RUBRIC =
  "Severity rubric for channel_readiness (grade against this, do not invent a scale). " +
  "placement_mismatch (range none→high): none = well-matched to the platform and audience; " +
  "low = minor tonal or pacing mismatch; medium = noticeably off for the placement or the audience; " +
  "high = wrong platform/format for the content, or content that would clearly alienate the target audience.";

export function evaluationPrompt(
  ctx: AgentContext,
  arc: ArcLabeling | null,
  arcExpectation: ArcExpectation | null,
): ChatMessage[] {
  const system =
    "You are evaluating a short-form ad on two metrics: creative_effectiveness (its internal storytelling) and " +
    "channel_readiness (its fit for the intended placement and audience). You are given the visual_frames with " +
    "their visual_descriptions and timestamps, the transcript_segments, the total duration, the " +
    "destination_platform, the campaign_goal, an audience_brief (target_audience, brand_voice/tone, and " +
    "required_messages — any field may be null), the narrative arc labeled in the previous step (each " +
    "frame's arc role, which roles are unfilled, and where the payoff resolves), and an arc_expectation for this " +
    "ad's duration (required_arc_roles — the arc roles a well-formed ad of this length must resolve — and " +
    "payoff_must_resolve_within_runtime). If narrative_arc is null the " +
    "labeling failed; judge only what the transcript and frames allow and use cannot_assess for arc-dependent " +
    "checks. Judge the five creative_effectiveness sub-checks (1–5) on the ad's own internal coherence, not on " +
    "brief conformance; use the audience_brief only for the channel_readiness sub-check (6).\n\n" +
    "Run each of these sub-checks and report each separately: (1) hook_missing — does the opening hook_window_ms " +
    "establish a relevant, attention-grabbing hook? (2) narrative_gap — do the frames flow logically, or is there " +
    "a jump/contradiction/unrelated cut? (3) value_prop_unclear — would a viewer with no prior knowledge " +
    "understand what the product is and why it matters? (4) story_incomplete — judge strictly against " +
    "arc_expectation: is every role in required_arc_roles actually resolved by the ad (use the labeled arc and its " +
    "unfilled_roles as evidence), and — only when payoff_must_resolve_within_runtime is true — does the payoff " +
    "resolve before the end (use payoff_resolved_at)? A required role left unfilled, or a required payoff that " +
    "never resolves, is story_incomplete; roles outside required_arc_roles are not required and their absence is " +
    "not a fault. If arc_expectation is null, return cannot_assess for this sub-check. (5) pacing_misallocation " +
    "— using the frames labeled detour and their timestamps, judge whether the time they take is disproportionate " +
    "to the ad's length. (6) placement_mismatch — is the ad appropriate for the destination_platform and its " +
    "viewing context, and do its tone, message, pacing, and use-case suit the target audience's needs and " +
    "motivations? Draw on the destination_platform, campaign_goal, and audience_brief. When target_audience is " +
    "null, judge only the platform/placement/viewing-context fit and do not guess the audience dimension; if " +
    "neither can be judged, use cannot_assess.\n\n" +
    CREATIVE_EFFECTIVENESS_RUBRIC +
    " " +
    CHANNEL_READINESS_RUBRIC +
    "\n\nReturn ONLY a single JSON object with these exact TOP-LEVEL keys and NO wrapper object around them: " +
    '"sub_checks" (array of { check_id, result: passed|failed|cannot_assess, severity: ' +
    "none|low|medium|high|critical, explanation (only when failed, naming the timestamp/frame) }), where " +
    'check_id is the exact snake_case identifier — one of "hook_missing", "narrative_gap", ' +
    '"value_prop_unclear", "story_incomplete", "pacing_misallocation", "placement_mismatch" — and NEVER the ' +
    "list number, " +
    '"confidence" (high|medium|low), "evidence" (array of { type: transcript|ocr|visual|brief|metadata, text, ' +
    'timestamp }), "explanation", "suggested_correction" (a specific actionable fix), "correction_type". Do not ' +
    "nest confidence/evidence/explanation under any other key. Use cannot_assess when the inputs do not let you " +
    "judge a sub-check; do not guess and do not report a pass to fill a gap.";
  return [
    { role: "system", content: system },
    { role: "user", content: evaluationInput(ctx, arc, arcExpectation) },
  ];
}
