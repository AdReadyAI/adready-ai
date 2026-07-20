/**
 * product-representation-agent/index.ts — Product Representation Agent
 *
 * Owned by: Yuchen Lin
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS (Mental Checklist):
 *
 *   1. product_clarity ("Can a viewer clearly identify what product is being advertised?")
 *      [ ] product_not_shown: Product packaging or product unit never visible.
 *      [ ] product_obscured: Product is in frame but heavily hidden, cropped, or too tiny to notice.
 *      [ ] product_appearance_wrong: Product color, label design, or shape does not match reference assets.
 *      [ ] product_name_unspoken: Brand or product name is never voiced or displayed in overlay text.
 *
 * INPUT (From EvidenceBundle):
 *   - keyframes[]: Images of selected video frames (with image_url pointing to CDN).
 *   - product_moments[]: Time ranges where the product appears in the video.
 *   - reference_assets[]: Approved product/packaging images (type: "product_image").
 *   - transcript_segments[]: Spoken brand or product name references.
 *
 * OUTPUT JSON STRUCTURE:
 *   [
 *     {
 *       "metric_id": "product_clarity",
 *       "agent": "product_representation",
 *       "metric_name": "Product Clarity",
 *       "question": "Can a viewer clearly identify what product is being advertised?",
 *       "result": "false",
 *       "severity": "medium",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "visual",
 *           "text": "Product packaging label is out of focus in all moments.",
 *           "timestamp": "00:12"
 *         }
 *       ],
 *       "explanation": "Product label is blurry and name is not clearly visible when packaging is shown.",
 *       "suggested_correction": "Ensure the high-resolution reference packaging assets are properly rendered and focused during the pack shot.",
 *       "correction_type": "technical_fix",
 *       "sub_checks": [
 *         {
 *           "check_id": "product_not_shown",
 *           "name": "Product Presence Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "product_obscured",
 *           "name": "Product Visibility Check",
 *           "result": "failed",
 *           "severity": "medium",
 *           "explanation": "Packaging labels are heavily blurred due to depth-of-field focus issues."
 *         },
 *         {
 *           "check_id": "product_appearance_wrong",
 *           "name": "Product Appearance",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "product_name_unspoken",
 *           "name": "Brand Name Mention Check",
 *           "result": "passed",
 *           "severity": "none"
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
import { type ChatClient, runProductRepresentationAgent } from "./agent.ts";

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
    const results = await runProductRepresentationAgent(bundle, deps.client);
    return jsonResponse(results, 200);
  } catch (err) {
    console.error("product-representation-agent failed", err);
    return jsonResponse({ error: "internal error" }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleRequest(req));
}
