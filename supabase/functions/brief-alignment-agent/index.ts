/**
 * brief-alignment-agent/index.ts — Brief Alignment Agent
 *
 * Owned by: Yuchen Lin
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS (Mental Checklist):
 *
 *   1. audience_fit ("Does the video speak to the intended audience's needs, motivations, or context?")
 *      [ ] demographic_mismatch: Vocabulary, slang, music, or scene setups clash with demographic habit profile.
 *      [ ] demographic_restricted: Targets age-restricted or legally prohibited demographics.
 *
 *   2. brief_adherence ("Does the video satisfy the core campaign objective and required message from the creative brief?")
 *      [ ] objective_missed: Primary video goal deviates from objective (e.g. calls for conversion when objective is awareness).
 *      [ ] required_message_missing: Core mandatory messaging statements or features from creative brief are omitted.
 *
 * INPUT (From EvidenceBundle):
 *   - creative_brief: Target audience profile, core campaign objectives, required messaging points.
 *   - transcript_segments[]: Spoken narrative/dialogue text.
 *   - ocr_segments[]: On-screen text.
 *   - scene_segments[]: Visual descriptions of scenes.
 *
 * OUTPUT JSON STRUCTURE:
 *   [
 *     {
 *       "metric_id": "audience_fit",
 *       "agent": "brief_alignment",
 *       "metric_name": "Audience Fit",
 *       "question": "Does the video speak to the intended audience's needs, motivations, or context?",
 *       "result": "false",
 *       "severity": "medium",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "transcript",
 *           "text": "Formal corporate narration style used.",
 *           "timestamp": "00:03"
 *         }
 *       ],
 *       "explanation": "Creative brief specifies targeting Gen Z snackers, but voiceover tone is overly formal and corporate.",
 *       "suggested_correction": "Re-record voiceover using a casual, high-energy tone matching target demographic habits.",
 *       "correction_type": "rewrite",
 *       "sub_checks": [
 *         {
 *           "check_id": "demographic_mismatch",
 *           "name": "Demographic Profile Match",
 *           "result": "failed",
 *           "severity": "medium",
 *           "explanation": "Narrative flow is heavily corporate, which clashes with the Gen Z demographic target."
 *         },
 *         {
 *           "check_id": "demographic_restricted",
 *           "name": "Age Restriction Check",
 *           "result": "passed",
 *           "severity": "none"
 *         }
 *       ]
 *     },
 *     {
 *       "metric_id": "brief_adherence",
 *       "agent": "brief_alignment",
 *       "metric_name": "Brief Adherence",
 *       "question": "Does the video satisfy the core campaign objective and required message from the creative brief?",
 *       "result": "false",
 *       "severity": "medium",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "brief",
 *           "text": "Required message: communicate fun tropical snack energy",
 *           "timestamp": ""
 *         },
 *         {
 *           "type": "transcript",
 *           "text": "Dialogue focuses heavily on diet restrictions and calories.",
 *           "timestamp": "00:05"
 *         }
 *       ],
 *       "explanation": "Core message about 'fun tropical energy' is weak and diluted, replaced by unapproved product features.",
 *       "suggested_correction": "Adjust copy in scene 2 to emphasize tropical fruits and taste excitement.",
 *       "correction_type": "rewrite",
 *       "sub_checks": [
 *         {
 *           "check_id": "objective_missed",
 *           "name": "Campaign Objective Alignment",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "required_message_missing",
 *           "name": "Creative Brief Message Adherence",
 *           "result": "failed",
 *           "severity": "medium",
 *           "explanation": "Mandatory message point 'fun tropical snack energy' is completely missing."
 *         }
 *       ]
 *     }
 *   ]
 */

import { verifyAuth } from "../shared/auth.ts";
import { getOpenRouterClient } from "../shared/claude.ts";
import type { EvidenceBundle } from "../shared/schemas.ts";
import {
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "./evidence.ts";
import { type ChatClient, runBriefAlignmentAgent } from "./agent.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRequest(
  req: Request,
  deps: { client: ChatClient } = {
    client: getOpenRouterClient() as unknown as ChatClient,
  },
): Promise<Response> {
  const authError = await verifyAuth(req);
  if (authError) return authError;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  let bundle: EvidenceBundle;
  try {
    bundle = validateEvidenceBundle(body);
  } catch (err) {
    if (err instanceof InvalidEvidenceBundleError) {
      return jsonResponse({ error: err.message }, 400);
    }
    throw err;
  }

  try {
    const results = await runBriefAlignmentAgent(bundle, deps.client);
    return jsonResponse(results, 200);
  } catch (err) {
    console.error("brief-alignment-agent failed", err);
    return jsonResponse({ error: "internal error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req));
}
