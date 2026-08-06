/**
 * evidence.ts — Prompt-context building for the Brief Alignment Agent.
 *
 * Consumes the DB-loaded AgentContext (parsed creative brief, campaign context,
 * transcript, OCR, and visual frames) and renders the plain-text context the
 * model grades against. Request validation is handled by the shared edge handler
 * via AgentRunRequestSchema, and the context shape is validated by the loader, so
 * no bespoke input validation lives here.
 */

import type { AgentContext, ParsedCreativeBrief } from "../shared/schemas.ts";

function formatBrief(brief: ParsedCreativeBrief): string {
  const lines = [`RAW BRIEF:\n${brief.raw_text || "(none)"}`];
  if (brief.target_audience) {
    lines.push(`TARGET AUDIENCE: ${brief.target_audience}`);
  }
  if (brief.brand_voice) {
    lines.push(`BRAND VOICE: ${brief.brand_voice}`);
  }
  if (brief.required_messages.length) {
    lines.push(
      `REQUIRED MESSAGES:\n${
        brief.required_messages.map((m) => `- ${m}`).join("\n")
      }`,
    );
  }
  if (brief.required_ctas.length) {
    lines.push(
      `REQUIRED CTAS:\n${brief.required_ctas.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  return lines.join("\n");
}

export function buildUserContent(context: AgentContext): string {
  const transcript = context.transcript_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const ocr = context.ocr_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const visuals = context.visual_frames
    .map((f) => `[${f.timestamp_ms}ms] ${f.visual_description}`)
    .join("\n");

  return [
    formatBrief(context.parsed_creative_brief),
    `CAMPAIGN GOAL: ${context.campaign_goal}`,
    `DESTINATION PLATFORM: ${context.destination_platform}`,
    `TRANSCRIPT:\n${transcript || "(none)"}`,
    `ON-SCREEN TEXT (OCR):\n${ocr || "(none)"}`,
    `VISUAL FRAMES:\n${visuals || "(none)"}`,
  ].join("\n\n");
}
