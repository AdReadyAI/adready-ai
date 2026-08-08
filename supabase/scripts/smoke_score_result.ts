#!/usr/bin/env -S deno run --allow-env --allow-net
/**
 * Smoke: POST score-result for a request that already has 9 agent_results rows.
 *
 * Requires a user JWT (createEdgeHandler auth). Service-role alone is not enough.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_USER_JWT=... \
 *   deno run --allow-env --allow-net supabase/scripts/smoke_score_result.ts \
 *     <request_id> <batch_id>
 */
const requestId = Deno.args[0];
const batchId = Deno.args[1];
const base = Deno.env.get("SUPABASE_URL");
const anon = Deno.env.get("SUPABASE_ANON_KEY");
const userJwt = Deno.env.get("SUPABASE_USER_JWT");

if (!requestId || !batchId) {
  console.error("Usage: smoke_score_result.ts <request_id> <batch_id>");
  Deno.exit(1);
}
if (!base || !anon || !userJwt) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_USER_JWT");
  Deno.exit(1);
}

const res = await fetch(`${base}/functions/v1/score-result`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${userJwt}`,
    apikey: anon,
  },
  body: JSON.stringify({ request_id: requestId, batch_id: batchId }),
});

const text = await res.text();
console.log(res.status, text);
if (!res.ok) Deno.exit(1);
