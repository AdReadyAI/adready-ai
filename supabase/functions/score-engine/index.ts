/**
 * Thin Edge Function: score-engine
 *
 * Stateless HTTP wrapper around the shared Score Engine v0.2.
 * Does not write to Postgres or invoke agents.
 *
 * POST /functions/v1/score-engine
 * Body: { "metric_results": MetricInput[] }
 * Response: ScoreEngineOutput
 */
import {
  parseScoreEngineRequest,
  scoreEngine,
} from "../_shared/score-engine/index.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const parsed = parseScoreEngineRequest(body);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }

  const output = scoreEngine(parsed.metric_results);
  return jsonResponse(200, output);
});
