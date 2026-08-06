/**
 * prompts.ts — Single-pass unified LLM prompt builder for Storyline Agent (Ultra-Lean Prompt)
 */

import type { ChatMessage } from "../shared/llm.ts";

import type { AgentContext } from "../shared/schemas.ts";

import type { ArcExpectation } from "./config.ts";

export const DEFAULT_HOOK_WINDOW_MS = 2500;

const MAX_FRAMES = 6;
const MAX_TRANSCRIPT_SEGMENTS = 8;
const MAX_OCR_SEGMENTS = 5;

function sampleEvenly<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

function compactVisualFrames(ctx: AgentContext) {
  return (ctx.visual_frames ?? []).map((f) => ({
    frame_id: f.frame_id,
    timestamp_ms: f.timestamp_ms,
    action: (f.action ?? "").slice(0, 120),
  }));
}

function compactTranscript(ctx: AgentContext) {
  return (ctx.transcript_segments ?? []).map((s) => ({
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    text: s.text.slice(0, 150),
  }));
}

function compactOcr(ctx: AgentContext) {
  return (ctx.ocr_segments ?? []).map((o) => ({
    start_ms: o.start_ms,
    end_ms: o.end_ms,
    text: o.text.slice(0, 100),
  }));
}

function unifiedInput(
  ctx: AgentContext,
  arcExpectation: ArcExpectation | null,
): string {
  const brief = ctx.parsed_creative_brief;

  return JSON.stringify({
    duration_ms: ctx.video_metadata.duration_ms,
    platform: ctx.destination_platform,
    goal: ctx.campaign_goal,
    audience: brief.target_audience ?? null,
    frames: sampleEvenly(compactVisualFrames(ctx), MAX_FRAMES),
    transcript: sampleEvenly(compactTranscript(ctx), MAX_TRANSCRIPT_SEGMENTS),
    ocr: sampleEvenly(compactOcr(ctx), MAX_OCR_SEGMENTS),
    arc_expectation: arcExpectation
      ? { roles: arcExpectation.expected_roles }
      : null,
  });
}

export function unifiedStorylinePrompt(
  ctx: AgentContext,
  arcExpectation: ArcExpectation | null,
): ChatMessage[] {
  const system =
    "Evaluate short-form ad storytelling. Output valid JSON ONLY:\n" +
    "{\n" +
    '  "arc": [{ "frame_id": "...", "role": "hook"|"problem"|"solution"|"proof"|"payoff"|"cta"|"detour", "confidence": "high"|"medium"|"low" }],\n' +
    '  "unfilled_roles": ["..."],\n' +
    '  "payoff_resolved_at": 123|null,\n' +
    '  "overall_confidence": "high"|"medium"|"low",\n' +
    '  "sub_checks": [\n' +
    '    { "check_id": "hook_missing", "result": "passed"|"failed"|"cannot_assess", "severity": "none"|"low"|"medium"|"high"|"critical", "explanation": "..." },\n' +
    '    { "check_id": "narrative_gap", "result": "passed"|"failed"|"cannot_assess", "severity": "none"|"low"|"medium"|"high", "explanation": "..." },\n' +
    '    { "check_id": "value_prop_unclear", "result": "passed"|"failed"|"cannot_assess", "severity": "none"|"low"|"medium", "explanation": "..." },\n' +
    '    { "check_id": "story_incomplete", "result": "passed"|"failed"|"cannot_assess", "severity": "none"|"low"|"medium", "explanation": "..." },\n' +
    '    { "check_id": "pacing_misallocation", "result": "passed"|"failed"|"cannot_assess", "severity": "none"|"low"|"medium", "explanation": "..." },\n' +
    '    { "check_id": "placement_mismatch", "result": "passed"|"failed"|"cannot_assess", "severity": "none"|"low"|"medium"|"high", "explanation": "..." }\n' +
    "  ],\n" +
    '  "confidence": "high"|"medium"|"low",\n' +
    '  "evidence": [{ "type": "transcript"|"ocr"|"visual"|"brief", "text": "...", "timestamp": "..." }],\n' +
    '  "explanation": "...",\n' +
    '  "suggested_correction": "...",\n' +
    '  "correction_type": "edit_recommendation"|"rewrite"|"none"\n' +
    "}";

  return [
    { role: "system", content: system },
    { role: "user", content: unifiedInput(ctx, arcExpectation) },
  ];
}
