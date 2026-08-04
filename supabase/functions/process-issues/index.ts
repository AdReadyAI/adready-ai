import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Edge Function: process-issues
 *
 * Evaluates agent test results for a given `request_id` or `batch_id`.
 * Filters metrics that failed (or have failed sub-checks) and updates/upserts
 * them into the `public.issues` table for downstream consumption.
 *
 * NOTE : subchecks  are discarded for now , it will be too much informations to display .
 */

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

  let body: { request_id?: string; batch_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const { request_id, batch_id } = body;
  if (!request_id && !batch_id) {
    return jsonResponse(400, {
      error: "Provide either request_id or batch_id",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    "";

  const supabase = createClient(supabaseUrl, supabaseKey);

  let queryRequests = supabase.from("requests").select("request_id, batch_id");

  if (request_id) {
    queryRequests = queryRequests.eq("request_id", request_id);
  } else if (batch_id) {
    queryRequests = queryRequests.eq("batch_id", batch_id);
  }

  const { data: targetRequests, error: reqsErr } = await queryRequests;

  if (reqsErr || !targetRequests || targetRequests.length === 0) {
    return jsonResponse(404, {
      error: "No requests found matching criteria",
      details: reqsErr,
    });
  }

  const requestBatchMap = new Map<string, string>(
    targetRequests.map((r) => [r.request_id, r.batch_id]),
  );
  const targetRequestIds = Array.from(requestBatchMap.keys());

  const { data: allResults, error: resultsErr } = await supabase
    .from("agent_results")
    .select("*")
    .in("request_id", targetRequestIds);

  if (resultsErr) {
    return jsonResponse(500, {
      error: "Error fetching agent_results",
      details: resultsErr,
    });
  }

  const { data: failedSubChecks, error: subChecksErr } = await supabase
    .from("agent_result_sub_checks")
    .select("*")
    .in("request_id", targetRequestIds)
    .in("result", ["false", "failed"]);

  if (subChecksErr) {
    return jsonResponse(500, {
      error: "Error fetching sub-checks",
      details: subChecksErr,
    });
  }

  const { data: evidenceList, error: evidenceErr } = await supabase
    .from("agent_result_evidence")
    .select("*")
    .in("request_id", targetRequestIds);

  if (evidenceErr) {
    return jsonResponse(500, {
      error: "Error fetching evidence",
      details: evidenceErr,
    });
  }

  const issuesMap = new Map<string, Record<string, unknown>>();

  for (const result of (allResults || [])) {
    const resultFailedSubChecks = (failedSubChecks || []).filter(
      (sc) =>
        sc.request_id === result.request_id &&
        sc.metric_id === result.metric_id && sc.agent === result.agent,
    );

    if (result.result !== "false" && resultFailedSubChecks.length === 0) {
      continue;
    }

    const currentBatchId = requestBatchMap.get(result.request_id)!;

    const matchingEvidences = (evidenceList || []).filter(
      (ev) =>
        ev.request_id === result.request_id &&
        ev.agent === result.agent &&
        ev.metric_id === result.metric_id,
    );

    const timestampEvidence = matchingEvidences.find((ev) =>
      ev.evidence_timestamp
    );

    const detailText = (result.explanation || "").trim(); // should be changed to let later.

    /*
    // we discard the subchecks for now , it will be too much informations to display .

    if (resultFailedSubChecks.length > 0) {
      if (detailText.length > 0) detailText += "\n\n";
      detailText += "Failed Checks:";
      for (const sc of resultFailedSubChecks) {
        detailText += `\n- ${sc.name}`;
        if (sc.explanation) {
          detailText += `: ${sc.explanation}`;
        }
      }
    }

    if (matchingEvidences.length > 0) {
      if (detailText.length > 0) detailText += "\n\n";
      detailText += "Evidence:";
      for (const ev of matchingEvidences) {
        detailText += `\n- [${ev.evidence_type}] ${ev.evidence_text}`;
      }
    }
    */

    const validSeverities = [
      "none",
      "low",
      "medium",
      "high",
      "critical",
      "cannot_assess",
    ];
    let severity = (result.severity || "none").toLowerCase();
    if (!validSeverities.includes(severity)) {
      severity = "none";
    }

    const validConfidences = ["low", "medium", "high", "unknown"];
    let confidence = (result.confidence || "unknown").toLowerCase();
    if (!validConfidences.includes(confidence)) {
      confidence = "unknown";
    }

    const issueKey = `${result.request_id}_${result.metric_id}`;
    issuesMap.set(issueKey, {
      request_id: result.request_id,
      batch_id: currentBatchId,
      metric_id: result.metric_id,
      title: result.metric_name ?? null,
      detail: detailText || null,
      severity,
      confidence,
      repair_suggestion: result.suggested_correction ?? null,
      video_timestamp: timestampEvidence?.evidence_timestamp ?? null,
    });
  }

  const issuesToInsert = Array.from(issuesMap.values());

  if (issuesToInsert.length === 0) {
    return jsonResponse(200, {
      status: "success",
      message: "No failed metrics found.",
      inserted_count: 0,
    });
  }

  const { data: insertedIssues, error: insertErr } = await supabase
    .from("issues")
    .upsert(issuesToInsert, { onConflict: "request_id,metric_id" })
    .select();

  if (insertErr) {
    return jsonResponse(500, {
      error: "Error inserting issues",
      details: insertErr,
    });
  }

  return jsonResponse(200, {
    status: "success",
    processed_requests: targetRequestIds,
    inserted_count: insertedIssues.length,
    inserted_issues: insertedIssues,
  });
});
