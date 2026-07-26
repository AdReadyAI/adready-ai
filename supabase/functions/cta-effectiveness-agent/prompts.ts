/**
 * prompts.ts — CTA agent prompt builders (Call 1 + Call 2).
 *
 * Call 1 derives the canonical CTA list from transcript and OCR (there is no
 * detected_ctas primitive), catching implicit CTAs and reporting each with the
 * numeric start_ms/end_ms of its source segment. Call 2 evaluates the five LLM
 * sub-checks against the resolved goal benchmark and the brief's required CTAs.
 * Functional first drafts, expected to be tuned.
 */

import type { ChatMessage } from "../shared/evaluator/llm_client.ts";
import type { AgentContext } from "../shared/schemas.ts";
import type { GoalBenchmark } from "../shared/evaluator/config/index.ts";
import type { CtaAcquisition } from "./response_schemas.ts";

function acquisitionInput(ctx: AgentContext): string {
  return JSON.stringify(
    {
      duration_ms: ctx.video_metadata.duration_ms,
      transcript_segments: ctx.transcript_segments,
      ocr_segments: ctx.ocr_segments,
    },
    null,
    2,
  );
}

export function acquisitionPrompt(ctx: AgentContext): ChatMessage[] {
  const system =
    "You are finding every call to action in a short-form ad. You are given the transcript_segments (spoken) and " +
    "ocr_segments (on-screen text), each with start_ms and end_ms, and the total duration. Derive every CTA from " +
    "them — there is no pre-extracted list. An implicit CTA counts, such as a product shown together with a URL or " +
    'a store name with no explicit "shop now" phrasing. Return only JSON with three fields. ctas is an array of ' +
    "{text, source, start_ms, end_ms, explicit}, where source is audio (from transcript), on_screen (from OCR), " +
    "or visual, start_ms/end_ms are copied from the segment the CTA was found in, and explicit is true for " +
    "imperative CTA language and false for an implicit one; list every occurrence, including a soft mid-video CTA " +
    "and a hard closing CTA as separate entries. cta_present is true if the array is non-empty and false " +
    "otherwise. overall_confidence is high, medium, or low. Do not judge whether the CTAs are good, do not assign " +
    "severity, and do not recommend fixes.";
  return [
    { role: "system", content: system },
    { role: "user", content: acquisitionInput(ctx) },
  ];
}

function evaluationInput(
  ctx: AgentContext,
  acquisition: CtaAcquisition | null,
  benchmark: GoalBenchmark | null,
): string {
  return JSON.stringify(
    {
      campaign_goal: ctx.campaign_goal,
      resolved_benchmark: benchmark, // null until the goal→CTA-type table is populated
      required_ctas_from_brief: ctx.parsed_creative_brief.required_ctas,
      canonical_ctas: acquisition?.ctas ?? null, // null when Call 1 could not acquire
      transcript_segments: ctx.transcript_segments,
      ocr_segments: ctx.ocr_segments,
    },
    null,
    2,
  );
}

const CTA_CLARITY_RUBRIC =
  "Severity rubric for cta_clarity (grade each sub-check against this; do not invent a scale). " +
  "cta_language_weak (range none→medium). cta_goal_mismatch (range none→high). cta_no_urgency (range none→low; " +
  "applies ONLY when campaign_goal is conversion — for any other goal return passed/none). " +
  "cta_destination_unclear (range none→medium). cta_absent (range none→critical, goal-conditional: awareness " +
  "none, consideration medium, repurchase high, conversion critical).";

export function evaluationPrompt(
  ctx: AgentContext,
  acquisition: CtaAcquisition | null,
  benchmark: GoalBenchmark | null,
): ChatMessage[] {
  const system =
    "You are evaluating the call to action in a short-form ad against the cta_clarity metric. You are given the " +
    "canonical CTA list from the previous step (each with text, source, timestamp, and whether it is explicit), " +
    "the campaign_goal and its resolved benchmark (none, soft, strong, or loyalty, with examples; null if not " +
    "yet available), the brief's required CTAs, and the transcript_segments and ocr_segments for context.\n\n" +
    "Run each of these sub-checks and report each separately: (1) cta_absent — is a CTA, explicit or implicit, " +
    'genuinely present at all? (2) cta_language_weak — is the wording specific and action-oriented ("Shop now", ' +
    '"Get 20% off") rather than passive or vague ("Check us out")? (3) cta_goal_mismatch — does the CTA\'s type ' +
    "match what the campaign goal calls for, comparing against the brief's required CTA where given? (4) " +
    'cta_no_urgency — does the CTA carry a time-pressure or incentive cue ("today only", "free shipping")? This ' +
    "applies only when campaign_goal is conversion; for any other goal return passed with severity none. (5) " +
    "cta_destination_unclear — would a viewer know where the CTA sends them (a website, store, or app named or " +
    "shown)?\n\n" +
    CTA_CLARITY_RUBRIC +
    "\n\nReturn ONLY a single JSON object with these exact TOP-LEVEL keys and NO wrapper object around them: " +
    '"sub_checks" (array of { check_id, result: passed|failed|cannot_assess, severity: ' +
    "none|low|medium|high|critical, explanation (only when failed, quoting the CTA text and its timestamp) }), " +
    'where check_id is the exact snake_case identifier — one of "cta_absent", "cta_language_weak", ' +
    '"cta_goal_mismatch", "cta_no_urgency", "cta_destination_unclear" — and NEVER the list number, ' +
    '"confidence" (high|medium|low), "evidence" (array of { type: transcript|ocr|visual|brief|metadata, text, ' +
    'timestamp }), "explanation", "suggested_correction" (a specific CTA rewrite or placement fix), ' +
    '"correction_type". Do not nest confidence/evidence/explanation under any other key. Use cannot_assess when ' +
    "the inputs do not let you judge a sub-check; do not guess.";
  return [
    { role: "system", content: system },
    { role: "user", content: evaluationInput(ctx, acquisition, benchmark) },
  ];
}
