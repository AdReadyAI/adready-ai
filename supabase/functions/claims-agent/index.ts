/**
 * claims-agent/index.ts — Claims Accuracy Agent
 *
 * Owned by: Saifeddine Rejeb
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS (Mental Checklist):
 *
 *   1. product_truth ("Are all explicit product claims supported by product page or source materials?")
 *      [ ] claim_unsupported: Claim is exaggerated or lacks nuance compared to the product page.
 *      [ ] claim_contradicted: Claim directly conflicts with product page/brief (e.g. claims clinical trial was run).
 *      [ ] forbidden_claim_used: Claim matches a forbidden claim listed on the product page.
 *
 *   2. policy_compliance ("Does the video avoid obvious policy, compliance, or disclosure issues?")
 *      [ ] missing_disclaimer: A critical required disclaimer or warning is entirely missing.
 *      [ ] disclaimer_contrast_low: Proximity text overlay has poor contrast or font size too small.
 *      [ ] disclaimer_duration_insufficient: Disclaimer duration too short on screen.
 *      [ ] policy_violation_depicted: Depicts illegal substances, safety hazards, copyright infringement.
 *
 * INPUT (From EvidenceBundle):
 *   - transcript_segments[]: Spoken narrative/dialogue text.
 *   - ocr_segments[]: Detected on-screen text with confidence, font_size_px, and duration.
 *   - detected_claims[]: Primitive claims list from Media Processing team.
 *   - creative_brief: Brief guidelines, target audience, approved/forbidden claims list.
 *
 * OUTPUT JSON STRUCTURE:
 *   [
 *     {
 *       "metric_id": "product_truth",
 *       "agent": "claims_accuracy",
 *       "metric_name": "Product Truth / Claim Support",
 *       "question": "Are all explicit product claims supported by product page or source materials?",
 *       "result": "false",
 *       "severity": "critical",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "transcript",
 *           "text": "clinically proven to reduce wrinkles in 7 days",
 *           "timestamp": "00:08"
 *         },
 *         {
 *           "type": "product_page",
 *           "text": "No clinical trial was conducted.",
 *           "timestamp": ""
 *         }
 *       ],
 *       "explanation": "Ad voiceover claims clinical proof, but the product page states only an informal survey was conducted.",
 *       "suggested_correction": "Replace with: 'In a 1-week survey, participants reported smoother skin.'",
 *       "correction_type": "rewrite",
 *       "sub_checks": [
 *         {
 *           "check_id": "claim_unsupported",
 *           "name": "Claim Support Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "claim_contradicted",
 *           "name": "Claim Contradiction Check",
 *           "result": "failed",
 *           "severity": "critical",
 *           "explanation": "Spoken claims assert clinical proof which is contradicted by product metadata."
 *         },
 *         {
 *           "check_id": "forbidden_claim_used",
 *           "name": "Forbidden Claim Check",
 *           "result": "passed",
 *           "severity": "none"
 *         }
 *       ]
 *     },
 *     {
 *       "metric_id": "policy_compliance",
 *       "agent": "claims_accuracy",
 *       "metric_name": "Policy / Compliance Readiness",
 *       "question": "Does the video avoid obvious policy, compliance, or disclosure issues?",
 *       "result": "false",
 *       "severity": "low",
 *       "confidence": "medium",
 *       "evidence": [
 *         {
 *           "type": "ocr",
 *           "text": "Disclaimer: Results may vary.",
 *           "timestamp": "00:02"
 *         }
 *       ],
 *       "explanation": "Legal disclaimer text size is smaller than safe platform guidelines.",
 *       "suggested_correction": "Increase font size of the disclaimer text overlay to at least 16px.",
 *       "correction_type": "edit_recommendation",
 *       "sub_checks": [
 *         {
 *           "check_id": "missing_disclaimer",
 *           "name": "Disclaimer Presence",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "disclaimer_contrast_low",
 *           "name": "Disclaimer Visibility",
 *           "result": "failed",
 *           "severity": "low",
 *           "explanation": "The font size of the disclaimer text is 10px, below the required 12px safe limit."
 *         },
 *         {
 *           "check_id": "disclaimer_duration_insufficient",
 *           "name": "Disclaimer Duration",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "policy_violation_depicted",
 *           "name": "Policy Depiction Check",
 *           "result": "passed",
 *           "severity": "none"
 *         }
 *       ]
 *     }
 *   ]
 */

import { verifyAuth } from "../shared/auth.ts";
import { anthropic, HAIKU, SONNET, OPUS } from "../shared/claude.ts";
import type { EvidenceBundle, MetricResult } from "../shared/schemas.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  return new Response("not implemented", { status: 501 });
});
