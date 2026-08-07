import { createSupabaseServiceClient, err, ok } from "../shared/index.ts";
import {
  AgentResultRow,
  buildIssuesSummary,
  EvidenceRow,
  IssueRecord,
  RequestRow,
  SubCheckRow,
} from "./logic.ts";

export type IssueProjectionScope = {
  requestId?: string;
  batchId?: string;
  userId?: string;
};

/**
 * Rebuild the current issue projection for an already-authorized scope.
 *
 * Interactive callers provide `userId` to preserve tenant ownership. Trusted
 * orchestration omits it after authenticating with the internal trigger secret.
 */
export async function projectCurrentIssues(
  scope: IssueProjectionScope,
): Promise<Response> {
  const supabase = createSupabaseServiceClient();
  let queryRequests = supabase.from("requests").select(
    "request_id, batch_id",
  );

  if (scope.userId) {
    queryRequests = queryRequests.eq("user_id", scope.userId);
  }
  if (scope.requestId) {
    queryRequests = queryRequests.eq("request_id", scope.requestId);
  }
  if (scope.batchId) {
    queryRequests = queryRequests.eq("batch_id", scope.batchId);
  }

  const { data: rawRequests, error: reqsErr } = await queryRequests;
  if (reqsErr || !rawRequests || rawRequests.length === 0) {
    return err("NOT_FOUND", "No requests found matching criteria", 404);
  }

  const targetRequests = rawRequests as unknown as RequestRow[];
  const requestBatchMap = new Map<string, string>(
    targetRequests.map((request) => [request.request_id, request.batch_id]),
  );
  const targetRequestIds = Array.from(requestBatchMap.keys());

  const [
    { data: rawResults, error: resultsErr },
    { data: rawSubChecks, error: subChecksErr },
    { data: rawEvidence, error: evidenceErr },
  ] = await Promise.all([
    supabase.from("agent_results").select("*").in(
      "request_id",
      targetRequestIds,
    ),
    supabase.from("agent_result_sub_checks").select("*").in(
      "request_id",
      targetRequestIds,
    ).in("result", ["false", "failed"]),
    supabase.from("agent_result_evidence").select("*").in(
      "request_id",
      targetRequestIds,
    ).order("evidence_order", { ascending: true }),
  ]);

  if (resultsErr) return err("DB_ERROR", "Error fetching agent_results", 500);
  if (subChecksErr) return err("DB_ERROR", "Error fetching sub-checks", 500);
  if (evidenceErr) return err("DB_ERROR", "Error fetching evidence", 500);

  const issuesToInsert = buildIssuesSummary(
    (rawResults || []) as unknown as AgentResultRow[],
    (rawSubChecks || []) as unknown as SubCheckRow[],
    (rawEvidence || []) as unknown as EvidenceRow[],
    requestBatchMap,
  );

  if (issuesToInsert.length === 0) {
    const { error: deleteErr } = await supabase.from("issues").delete().in(
      "request_id",
      targetRequestIds,
    );
    if (deleteErr) {
      return err("DB_ERROR", "Error removing resolved issues", 500);
    }
    return ok({
      status: "success",
      message: "No failed metrics found.",
      inserted_count: 0,
    });
  }

  // Synchronize each Ad Creative independently because metric IDs are unique
  // only within a request and resolved failures must not remain visible.
  for (const targetRequestId of targetRequestIds) {
    const currentMetricIds = new Set(
      issuesToInsert
        .filter((issue) => issue.request_id === targetRequestId)
        .map((issue) => issue.metric_id),
    );
    const { data: existingIssues, error: existingIssuesErr } = await supabase
      .from("issues")
      .select("metric_id")
      .eq("request_id", targetRequestId);

    if (existingIssuesErr) {
      return err("DB_ERROR", "Error fetching existing issues", 500);
    }

    const resolvedMetricIds = (existingIssues || [])
      .map((issue) => issue.metric_id)
      .filter((metricId) => !currentMetricIds.has(metricId));
    if (resolvedMetricIds.length > 0) {
      const { error: deleteErr } = await supabase.from("issues").delete()
        .eq("request_id", targetRequestId)
        .in("metric_id", resolvedMetricIds);
      if (deleteErr) {
        return err("DB_ERROR", "Error removing resolved issues", 500);
      }
    }
  }

  const { data: insertedIssues, error: insertErr } = await supabase.from(
    "issues",
  ).upsert(issuesToInsert, { onConflict: "request_id,metric_id" }).select();
  if (insertErr) return err("DB_ERROR", "Error inserting issues", 500);

  const insertedArray = (insertedIssues || []) as unknown as IssueRecord[];
  return ok({
    status: "success",
    processed_requests: targetRequestIds,
    inserted_count: insertedArray.length,
    inserted_issues: insertedArray,
  });
}
