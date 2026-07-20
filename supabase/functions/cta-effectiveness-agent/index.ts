/**
 * cta-effectiveness-agent/index.ts — CTA Effectiveness Agent
 *
 * Owned by: Kira Cho
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS (Mental Checklist):
 *
 *   1. cta_clarity ("Is there a clear and appropriate next step for the viewer?")
 *      [ ] cta_absent: No spoken, visual, or written CTA present in the video.
 *      [ ] cta_buried: CTA is shown only in the first 5 seconds and never repeated at the closing end.
 *      [ ] cta_mistimed: CTA doesn't land in the last 20-30% of the runtime, or dwells too briefly to register.
 *      [ ] cta_language_weak: CTA language is too passive, vague, or non-specific.
 *      [ ] cta_goal_mismatch: CTA style mismatch against campaign objective (e.g. conversion requires strong action).
 *      [ ] cta_no_urgency: No urgency or incentive language where the goal calls for it (conversion only).
 *      [ ] cta_destination_unclear: The destination (website, store, app) isn't stated clearly.
 *      [ ] cta_low_visibility: CTA contrast ratio is too low or font size is illegible.
 *      [ ] cta_platform_mismatch: Phrasing violates platform swipe/action conventions (e.g. "swipe up" on modern TikTok).
 *
 * DB CONTEXT:
 *   - Loads transcript, OCR, video metadata, parsed brief, campaign goal, and
 *     platform context by review_id + variant_id.
 *   - Derives CTA candidates from transcript/OCR text; detected CTAs are not
 *     supplied by the media pipeline.
 *
 * OUTPUT JSON STRUCTURE:
 *   [
 *     {
 *       "metric_id": "cta_clarity",
 *       "agent": "cta_effectiveness",
 *       "metric_name": "CTA Clarity",
 *       "question": "Is there a clear and appropriate next step for the viewer?",
 *       "result": "false",
 *       "severity": "critical",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "brief",
 *           "text": "Required CTA: Try Mango Moon",
 *           "timestamp": ""
 *         },
 *         {
 *           "type": "visual",
 *           "text": "No CTA visible on screen or spoken in audio.",
 *           "timestamp": ""
 *         }
 *       ],
 *       "explanation": "The required CTA 'Try Mango Moon' is entirely missing on this conversion-focused campaign.",
 *       "suggested_correction": "Add a prominent closing end card with the button text 'Try Mango Moon'.",
 *       "correction_type": "edit_recommendation",
 *       "sub_checks": [
 *         {
 *           "check_id": "cta_absent",
 *           "name": "CTA Presence",
 *           "result": "failed",
 *           "severity": "critical",
 *           "explanation": "No verbal or visual CTA was found."
 *         },
 *         {
 *           "check_id": "cta_buried",
 *           "name": "CTA Position Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_mistimed",
 *           "name": "CTA Timing Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_language_weak",
 *           "name": "CTA Phrasing Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_goal_mismatch",
 *           "name": "CTA Goal Alignment",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_no_urgency",
 *           "name": "CTA Urgency Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_destination_unclear",
 *           "name": "CTA Destination Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_low_visibility",
 *           "name": "CTA Visibility Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "cta_platform_mismatch",
 *           "name": "CTA Platform Alignment",
 *           "result": "passed",
 *           "severity": "none"
 *         }
 *       ]
 *     }
 *   ]
 */

// import { createEdgeHandler, ok } from "../shared/index.ts";
// import { AgentRunRequestSchema } from "../shared/schemas.ts";
// import type { MetricResult } from "../shared/schemas.ts";
// // import { chat } from "../shared/llm.ts";

// createEdgeHandler("cta-effectiveness-agent", AgentRunRequestSchema, async (req, ctx) => {
//   const _run = ctx.body;
//   // TODO: Load DB-backed agent context by review_id + variant_id.

//   // TODO: Extract CTAs from transcript/OCR and evaluate timing, clarity, and platform fit.

//   const results: MetricResult[] = [];
//   return ok(results);
// });
