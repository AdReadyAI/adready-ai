/**
 * prompts.ts — LLM prompt builders for CTA acquisition and evaluation
 */

import type { ChatMessage } from "../shared/llm.ts";

import type { AgentContext } from "../shared/schemas.ts";

import type { GoalBenchmark } from "./config.ts";

import type { CtaAcquisition } from "./response_schemas.ts";

function compactTranscript(ctx: AgentContext) {
  return (ctx.transcript_segments ?? []).map((s) => ({
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    text: s.text,
  }));
}

function compactOcr(ctx: AgentContext) {
  return (ctx.ocr_segments ?? []).map((o) => ({
    start_ms: o.start_ms,
    end_ms: o.end_ms,
    text: o.text,
  }));
}

function acquisitionInput(ctx: AgentContext): string {
  return JSON.stringify({
    duration_ms: ctx.video_metadata.duration_ms,
    transcript_segments: compactTranscript(ctx),
    ocr_segments: compactOcr(ctx),
  });
}

export function acquisitionPrompt(ctx: AgentContext): ChatMessage[] {
  const system =
    "You are finding every call to action in a short-form ad. You are given transcript_segments and " +
    "ocr_segments with start_ms and end_ms, and the total duration. Derive every CTA from them. An " +
    "implicit CTA counts (such as a product shown together with a URL). Return ONLY valid JSON: " +
    '{ "ctas": [{ "text": "...", "source": "audio"|"on_screen"|"visual", "start_ms": 123, "end_ms": 456, ' +
    '"explicit": true|false }], "cta_present": true|false, "overall_confidence": "high"|"medium"|"low" }.';

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
  return JSON.stringify({
    campaign_goal: ctx.campaign_goal,
    resolved_benchmark: benchmark,
    required_ctas_from_brief: ctx.parsed_creative_brief.required_ctas,
    canonical_ctas: acquisition?.ctas ?? null,
    transcript_segments: compactTranscript(ctx),
    ocr_segments: compactOcr(ctx),
  });
}

const CTA_CLARITY_RUBRIC = "Severity rubric for cta_clarity: " +
  "cta_language_weak (range none→medium). cta_goal_mismatch (range none→high). cta_no_urgency (range none→low; " +
  "applies ONLY when campaign_goal is conversion). cta_destination_unclear (range none→medium). " +
  "cta_absent (range none→critical, goal-conditional: awareness none, consideration medium, repurchase high, conversion critical).";

export function evaluationPrompt(
  ctx: AgentContext,
  acquisition: CtaAcquisition | null,
  benchmark: GoalBenchmark | null,
): ChatMessage[] {
  const system =
    "You are evaluating the call to action in a short-form ad against the cta_clarity metric. " +
    "Evaluate these sub-checks: (1) cta_absent, (2) cta_language_weak, (3) cta_goal_mismatch, " +
    "(4) cta_no_urgency (applies ONLY when campaign_goal is conversion; return passed/none for other goals), " +
    "(5) cta_destination_unclear.\n\n" +
    CTA_CLARITY_RUBRIC +
    "\n\nReturn ONLY a single JSON object with these top-level keys: " +
    '"sub_checks": [{ "check_id": "...", "result": "passed"|"failed"|"cannot_assess", ' +
    '"severity": "none"|"low"|"medium"|"high"|"critical", "explanation": "..." }], ' +
    '"confidence": "high"|"medium"|"low", "evidence": [{ "type": "transcript"|"ocr"|"visual"|"brief"|"metadata", "text": "...", "timestamp": "..." }], ' +
    '"explanation": "...", "suggested_correction": "...", "correction_type": "...".';

  return [
    { role: "system", content: system },
    { role: "user", content: evaluationInput(ctx, acquisition, benchmark) },
  ];
}
