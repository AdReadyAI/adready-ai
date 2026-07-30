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
    "is high, medium, or low for the labeling as a whole; if the visual_frames are too few or too sparse to cover " +
    "the full duration, set overall_confidence to low — a thin frame set means the analysis data is incomplete, " +
    "not that the ad itself lacks content. Do not assess quality, do not assign severity, and do " +
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
      // How much analysis data backs this judgment. A low frame/segment count
      // relative to duration_ms means the inputs are sparse — judge accordingly
      // (see the insufficient-data rule in the system prompt), do not read
      // sparsity as the ad lacking visuals or story.
      input_density: {
        visual_frame_count: ctx.visual_frames.length,
        transcript_segment_count: ctx.transcript_segments.length,
      },
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
  "low = minor tonal or convention mismatch for the placement; medium = noticeably off for the placement or the " +
  "audience; high = wrong platform/format for the content, or content that would clearly alienate the target " +
  "audience.";

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
    "payoff_must_resolve_within_runtime), plus an input_density block (how many visual_frames and " +
    "transcript_segments back this analysis). If narrative_arc is null the " +
    "labeling failed; judge only what the transcript and frames allow and use cannot_assess for arc-dependent " +
    "checks. Judge the five creative_effectiveness sub-checks (1–5) on the ad's own internal coherence, not on " +
    "brief conformance; use the audience_brief only for the channel_readiness sub-check (6). Internal craft — hook, " +
    "pacing, narrative flow, and value proposition — is graded ONLY under sub-checks 1–5; sub-check 6 must not " +
    "re-grade pacing, hook, or narrative, it judges platform and audience fit alone from the ad's tone, message, " +
    "and format. Do NOT cite the number of visual_frames, transcript coverage gaps, or any analysis-data sparsity " +
    "as a placement problem — those are input-density artifacts, not properties of the ad. The INSUFFICIENT DATA " +
    "rule applies to placement_mismatch too: when input_density is low, judge placement only from the tone/message/" +
    "format evidence you do have, and return cannot_assess if that is not enough to judge platform and audience fit.\n\n" +
    "INSUFFICIENT DATA comes before — and overrides — every failure rule below. Return cannot_assess for the " +
    "visual/arc-dependent sub-checks (hook_missing, narrative_gap, story_incomplete, pacing_misallocation) whenever " +
    "the analysis is too thin to trust: input_density is low (few visual_frames or transcript_segments relative to " +
    "duration_ms, or obvious gaps in coverage), OR narrative_arc.overall_confidence is 'low'. In that case " +
    "unfilled arc roles, a null payoff_resolved_at, and missing frames are symptoms of incomplete ANALYSIS DATA and " +
    "are NOT evidence of a failure — you must NOT fail story_incomplete, hook_missing, or narrative_gap on them. Do " +
    "NOT infer from sparse or low-confidence analysis that the ad lacks a hook, visuals, a narrative, or a payoff — " +
    "absence of analysis data is not absence of creative content. Only when input_density is adequate AND " +
    "narrative_arc.overall_confidence is 'medium' or 'high' may these sub-checks be failed.\n\n" +
    "Run each of these sub-checks and report each separately: (1) hook_missing — does the opening hook_window_ms " +
    "establish a relevant, attention-grabbing hook? (2) narrative_gap — do the frames flow logically, or is there " +
    "a jump/contradiction/unrelated cut? (3) value_prop_unclear — would a viewer with no prior knowledge " +
    "understand what the product is and why it matters? (4) story_incomplete — judge strictly against " +
    "arc_expectation: is every role in required_arc_roles actually resolved by the ad (use the labeled arc and its " +
    "unfilled_roles as evidence), and — only when payoff_must_resolve_within_runtime is true — does the payoff " +
    "resolve before the end (use payoff_resolved_at)? A required role left unfilled, or a required payoff that " +
    "never resolves, is story_incomplete; roles outside required_arc_roles are not required and their absence is " +
    "not a fault. But apply the INSUFFICIENT DATA rule first: an unfilled role or a null payoff_resolved_at is " +
    "evidence of incompleteness ONLY when input_density is adequate AND narrative_arc.overall_confidence is " +
    "'medium' or 'high'. When the labeling is sparse or low-confidence, an unfilled required role means the arc " +
    "could not be observed, not that the ad is incomplete — return cannot_assess. If arc_expectation is null, " +
    "return cannot_assess for this sub-check. (5) " +
    "pacing_misallocation — using the frames labeled detour and their timestamps, judge whether the time they " +
    "take is disproportionate to the ad's length. (6) placement_mismatch — is the ad appropriate for THIS " +
    "destination_platform and its viewing context, and would it resonate with rather than alienate the target " +
    "audience? Judge only placement-level fit: the platform's format and style conventions, the viewing context " +
    "(vertical, sound-on vs sound-off, feed vs search, watch behavior), and audience appropriateness. Do NOT " +
    "re-grade the ad's internal pacing, hook, or narrative here — those belong to sub-checks 1–5. Draw on the " +
    "destination_platform, campaign_goal, and audience_brief. A low visual_frame count or a stretch of transcript " +
    "with no text is analysis-coverage sparsity, never a placement fault: do NOT cite 'only N visual frames', an " +
    "'X-second gap', or similar analysis-density observations as evidence here — judge the ad's tone, message, and " +
    "format instead, and if those are too thin to judge platform/audience fit, return cannot_assess. When " +
    "target_audience is null, judge only the platform/placement/viewing-context fit and do not guess the audience " +
    "dimension; if neither can be judged, use cannot_assess.\n\n" +
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
    "nest confidence/evidence/explanation under any other key. Whenever any sub-check fails, you MUST include a " +
    "non-empty top-level explanation and at least one evidence entry naming the timestamp/frame — do not return a " +
    "failure with no evidence. Set correction_type to none when nothing needs fixing. Use cannot_assess when the " +
    "inputs do not let you judge a sub-check; do not guess and do not report a pass to fill a gap.";
  return [
    { role: "system", content: system },
    { role: "user", content: evaluationInput(ctx, arc, arcExpectation) },
  ];
}
