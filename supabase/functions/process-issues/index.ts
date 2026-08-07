import { z } from "zod";
import {
  createEdgeHandler,
  createSupabaseServiceClient,
  err,
  ok,
} from "../shared/index.ts";

const ProcessIssuesSchema = z
  .object({
    request_id: z.string().optional(),
    batch_id: z.string().optional(),
  })
  .refine((data) => data.request_id || data.batch_id, {
    message: "Provide either request_id or batch_id",
  });

type ProcessIssuesInput = z.infer<typeof ProcessIssuesSchema>;

import {
  AgentResultRow,
  buildIssuesSummary,
  EvidenceRow,
  IssueRecord,
  RequestRow,
  SubCheckRow,
} from "./logic.ts";

createEdgeHandler<ProcessIssuesInput>(
  "process-issues",
  ProcessIssuesSchema,
  async (_req, { body, user }) => {
    const { request_id, batch_id } = body;

    const supabase = createSupabaseServiceClient();

    let queryRequests = supabase.from("requests").select(
      "request_id, batch_id",
    ).eq("user_id", user.id);

    if (request_id) {
      queryRequests = queryRequests.eq("request_id", request_id);
    } else if (batch_id) {
      queryRequests = queryRequests.eq("batch_id", batch_id);
    }

    const { data: rawRequests, error: reqsErr } = await queryRequests;

    if (reqsErr || !rawRequests || rawRequests.length === 0) {
      return err("NOT_FOUND", "No requests found matching criteria", 404);
    }

    const targetRequests = rawRequests as unknown as RequestRow[];

    const requestBatchMap = new Map<string, string>(
      targetRequests.map((r) => [r.request_id, r.batch_id]),
    );
    const targetRequestIds = Array.from(requestBatchMap.keys());

    const [
      { data: rawResults, error: resultsErr },
      { data: rawSubChecks, error: subChecksErr },
      { data: rawEvidence, error: evidenceErr },
    ] = await Promise.all([
      supabase
        .from("agent_results")
        .select("*")
        .in("request_id", targetRequestIds),
      supabase
        .from("agent_result_sub_checks")
        .select("*")
        .in("request_id", targetRequestIds)
        .in("result", ["false", "failed"]),
      supabase
        .from("agent_result_evidence")
        .select("*")
        .in("request_id", targetRequestIds)
        .order("evidence_order", { ascending: true }),
    ]);

    if (resultsErr) return err("DB_ERROR", "Error fetching agent_results", 500);
    if (subChecksErr) return err("DB_ERROR", "Error fetching sub-checks", 500);
    if (evidenceErr) return err("DB_ERROR", "Error fetching evidence", 500);

    const allResults = (rawResults || []) as unknown as AgentResultRow[];
    const failedSubChecks = (rawSubChecks || []) as unknown as SubCheckRow[];
    const evidenceList = (rawEvidence || []) as unknown as EvidenceRow[];

    const issuesToInsert = buildIssuesSummary(
      allResults,
      failedSubChecks,
      evidenceList,
      requestBatchMap,
    );

    if (issuesToInsert.length === 0) {
      // The issues table is a current projection of failures, so a successful
      // re-evaluation must remove issues that no longer fail.
      const { error: deleteErr } = await supabase
        .from("issues")
        .delete()
        .in("request_id", targetRequestIds);

      if (deleteErr) {
        return err("DB_ERROR", "Error removing resolved issues", 500);
      }

      return ok({
        status: "success",
        message: "No failed metrics found.",
        inserted_count: 0,
      });
    }

    // Synchronize each Review Request independently because metric IDs are
    // unique only within a request. This prevents resolved failures from
    // lingering while preserving failures that remain current.
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
        const { error: deleteErr } = await supabase
          .from("issues")
          .delete()
          .eq("request_id", targetRequestId)
          .in("metric_id", resolvedMetricIds);

        if (deleteErr) {
          return err("DB_ERROR", "Error removing resolved issues", 500);
        }
      }
    }

    const { data: insertedIssues, error: insertErr } = await supabase
      .from("issues")
      .upsert(issuesToInsert, { onConflict: "request_id,metric_id" })
      .select();

    if (insertErr) {
      return err("DB_ERROR", "Error inserting issues", 500);
    }

    const insertedArray = (insertedIssues || []) as unknown as IssueRecord[];

    return ok({
      status: "success",
      processed_requests: targetRequestIds,
      inserted_count: insertedArray.length,
      inserted_issues: insertedArray,
    });
  },
);
