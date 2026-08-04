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

interface RequestRow {
  request_id: string;
  batch_id: string;
}

interface AgentResultRow {
  request_id: string;
  metric_id: string;
  agent: string;
  result?: string | null;
  explanation?: string | null;
  severity?: string | null;
  confidence?: string | null;
  metric_name?: string | null;
  suggested_correction?: string | null;
}

interface SubCheckRow {
  request_id: string;
  metric_id: string;
  agent: string;
  result?: string | null;
}

interface EvidenceRow {
  request_id: string;
  metric_id: string;
  agent: string;
  evidence_timestamp?: string | number | null;
}

interface IssueRecord {
  request_id: string;
  batch_id: string;
  metric_id: string;
  title: string | null;
  detail: string | null;
  severity: string;
  confidence: string;
  repair_suggestion: string | null;
  video_timestamp: string | number | null;
}

createEdgeHandler<ProcessIssuesInput>(
  "process-issues",
  ProcessIssuesSchema,
  async (_req, { body }) => {
    const { request_id, batch_id } = body;

    const supabase = createSupabaseServiceClient();

    let queryRequests = supabase.from("requests").select(
      "request_id, batch_id",
    );

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
        .in("request_id", targetRequestIds),
    ]);

    if (resultsErr) return err("DB_ERROR", "Error fetching agent_results", 500);
    if (subChecksErr) return err("DB_ERROR", "Error fetching sub-checks", 500);
    if (evidenceErr) return err("DB_ERROR", "Error fetching evidence", 500);

    const allResults = (rawResults || []) as unknown as AgentResultRow[];
    const failedSubChecks = (rawSubChecks || []) as unknown as SubCheckRow[];
    const evidenceList = (rawEvidence || []) as unknown as EvidenceRow[];

    const issuesMap = new Map<string, IssueRecord>();

    for (const result of allResults) {
      const resultFailedSubChecks = failedSubChecks.filter(
        (sc) =>
          sc.request_id === result.request_id &&
          sc.metric_id === result.metric_id &&
          sc.agent === result.agent,
      );

      if (result.result !== "false" && resultFailedSubChecks.length === 0) {
        continue;
      }

      const currentBatchId = requestBatchMap.get(result.request_id)!;

      const matchingEvidences = evidenceList.filter(
        (ev) =>
          ev.request_id === result.request_id &&
          ev.agent === result.agent &&
          ev.metric_id === result.metric_id,
      );

      const timestampEvidence = matchingEvidences.find((ev) =>
        ev.evidence_timestamp
      );

      const detailText = (result.explanation || "").trim();

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
      return ok({
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
