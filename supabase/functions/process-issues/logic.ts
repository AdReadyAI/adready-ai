export interface RequestRow {
  request_id: string;
  batch_id: string;
}

export interface AgentResultRow {
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

export interface SubCheckRow {
  request_id: string;
  metric_id: string;
  agent: string;
  result?: string | null;
}

export interface EvidenceRow {
  request_id: string;
  metric_id: string;
  agent: string;
  evidence_timestamp?: string | number | null;
}

export interface IssueRecord {
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

export function buildIssuesSummary(
  allResults: AgentResultRow[],
  failedSubChecks: SubCheckRow[],
  evidenceList: EvidenceRow[],
  requestBatchMap: Map<string, string>,
): IssueRecord[] {
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

  return Array.from(issuesMap.values());
}
