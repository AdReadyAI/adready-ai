import { assertEquals } from "jsr:@std/assert@1";
import {
  AgentResultRow,
  buildIssuesSummary,
  EvidenceRow,
  SubCheckRow,
} from "../../../functions/process-issues/logic.ts";

Deno.test("buildIssuesSummary constructs simple issue correctly", () => {
  const requestBatchMap = new Map([["req-1", "batch-1"]]);
  const results: AgentResultRow[] = [
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      result: "false",
      explanation: "Something went wrong",
      severity: "high",
      confidence: "medium",
      metric_name: "My Metric",
      suggested_correction: "Fix it",
    },
  ];

  const issues = buildIssuesSummary(results, [], [], requestBatchMap);

  assertEquals(issues.length, 1);
  assertEquals(issues[0], {
    request_id: "req-1",
    batch_id: "batch-1",
    metric_id: "m-1",
    title: "My Metric",
    detail: "Something went wrong",
    severity: "high",
    confidence: "medium",
    repair_suggestion: "Fix it",
    video_timestamp: null,
  });
});

Deno.test("buildIssuesSummary normalizes invalid severities and confidences", () => {
  const requestBatchMap = new Map([["req-1", "batch-1"]]);
  const results: AgentResultRow[] = [
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      result: "false",
      severity: "super-critical", // invalid
      confidence: "100%", // invalid
    },
  ];

  const issues = buildIssuesSummary(results, [], [], requestBatchMap);

  assertEquals(issues.length, 1);
  assertEquals(issues[0].severity, "none");
  assertEquals(issues[0].confidence, "unknown");
});

Deno.test("buildIssuesSummary extracts timestamp from evidence", () => {
  const requestBatchMap = new Map([["req-1", "batch-1"]]);
  const results: AgentResultRow[] = [
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      result: "false",
    },
  ];

  const evidences: EvidenceRow[] = [
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      evidence_order: 1,
      evidence_timestamp: "00:15",
    },
  ];

  const issues = buildIssuesSummary(results, [], evidences, requestBatchMap);

  assertEquals(issues.length, 1);
  assertEquals(issues[0].video_timestamp, "00:15");
});

Deno.test("buildIssuesSummary keeps the first evidence timestamp empty", () => {
  const requestBatchMap = new Map([["req-1", "batch-1"]]);
  const results: AgentResultRow[] = [
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      result: "false",
    },
  ];
  const evidences: EvidenceRow[] = [
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      evidence_order: 1,
      evidence_timestamp: "",
    },
    {
      request_id: "req-1",
      metric_id: "m-1",
      agent: "agent-1",
      evidence_order: 2,
      evidence_timestamp: "00:15",
    },
  ];

  const issues = buildIssuesSummary(results, [], evidences, requestBatchMap);

  assertEquals(issues[0].video_timestamp, "");
});

Deno.test("buildIssuesSummary triggers if result is true but has failed subchecks", () => {
  const requestBatchMap = new Map([["req-2", "batch-2"]]);
  const results: AgentResultRow[] = [
    {
      request_id: "req-2",
      metric_id: "m-2",
      agent: "agent-2",
      result: "true",
    },
  ];

  const subChecks: SubCheckRow[] = [
    {
      request_id: "req-2",
      metric_id: "m-2",
      agent: "agent-2",
      result: "false", // triggers failure
    },
  ];

  const issues = buildIssuesSummary(results, subChecks, [], requestBatchMap);

  assertEquals(issues.length, 1);
  assertEquals(issues[0].request_id, "req-2");
});

Deno.test("buildIssuesSummary ignores true results with no failed subchecks", () => {
  const requestBatchMap = new Map([["req-2", "batch-2"]]);
  const results: AgentResultRow[] = [
    {
      request_id: "req-2",
      metric_id: "m-2",
      agent: "agent-2",
      result: "true",
    },
  ];

  const issues = buildIssuesSummary(results, [], [], requestBatchMap);

  assertEquals(issues.length, 0);
});
