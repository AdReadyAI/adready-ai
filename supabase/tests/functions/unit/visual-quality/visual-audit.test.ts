import { assertEquals } from "@std/assert";

import { parseVisualAuditResponse } from "../../../../functions/visual-quality-agent/visual-audit.ts";

Deno.test("visual audit normalizes null model evidence to no evidence", () => {
  const findings = parseVisualAuditResponse(JSON.stringify({
    findings: [
      {
        check_id: "ai_artifacts",
        severity: 0,
        explanation: "No visible artifacts.",
        evidence_text: null,
        evidence_timestamp_ms: null,
        confidence_score: 0.9,
      },
      {
        check_id: "poor_framing_lighting",
        severity: 0,
        explanation: "Framing and lighting are acceptable.",
        evidence_text: null,
        evidence_timestamp_ms: null,
        confidence_score: 0.9,
      },
      {
        check_id: "jarring_transitions",
        severity: 0,
        explanation: "Transitions are continuous.",
        evidence_text: null,
        evidence_timestamp_ms: null,
        confidence_score: 0.9,
      },
    ],
  }));

  assertEquals(
    findings.map((finding) => finding.evidence_text),
    ["", "", ""],
  );
});
