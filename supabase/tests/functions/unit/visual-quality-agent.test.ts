/**
 * visual-quality-agent.test.ts — Unit tests for the Visual Quality Agent pipeline.
 *
 * Tests the agent orchestration using injected dependencies.
 * No database, environment variables, OpenRouter, or LLM calls are used.
 */

import { assertEquals } from "@std/assert";

import {
  runVisualQualityAgent,
  visualQualityDependencies,
} from "../../../functions/visual-quality-agent/agent.ts";

import {
  cleanVisualQualityContext,
  failingVisualQualityContext,
} from "./test-fixtures/visual-quality-fixtures.ts";
import { VisualQualityDependencies } from "../../../functions/visual-quality-agent/types.ts";

Deno.test("visual-quality-agent: returns passing production readiness", async () => {
  const deps: VisualQualityDependencies = {
    ...visualQualityDependencies,

    getAgentContext: () => Promise.resolve(cleanVisualQualityContext),

    auditVisualQuality: () => Promise.resolve([]),

    evaluateProductionReadiness: () => ({
      metric_id: "production_readiness",
      agent: "visual_quality",
      metric_name: "Production / Asset Readiness",
      question:
        "Is the video technically complete enough to be reviewed or launched?",
      result: "true",
      severity: "none",
      confidence: "high",
      explanation: "No material production-quality issues were detected.",
      suggested_correction: "No correction is required.",
      correction_type: "none",
      sub_checks: [],
    }),
  };

  const results = await runVisualQualityAgent(
    cleanVisualQualityContext.request_id,
    deps,
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].metric_id, "production_readiness");
  assertEquals(results[0].agent, "visual_quality");
  assertEquals(results[0].result, "true");
  assertEquals(results[0].severity, "none");
});

Deno.test("visual-quality-agent: returns failed production readiness", async () => {
  const deps: VisualQualityDependencies = {
    ...visualQualityDependencies,

    getAgentContext: () => Promise.resolve(failingVisualQualityContext),

    auditVisualQuality: () =>
      Promise.resolve([
        {
          check_id: "ai_artifacts" as const,
          severity: 3 as const,
          explanation: "AI morphing artifacts detected.",
          evidence_text: "The subject's face visibly morphs between frames.",
          evidence_timestamp_ms: 7000,
          confidence_score: 0.95,
        },
      ]),

    evaluateProductionReadiness: () => ({
      metric_id: "production_readiness",
      agent: "visual_quality",
      metric_name: "Production / Asset Readiness",
      question:
        "Is the video technically complete enough to be reviewed or launched?",
      result: "false",
      severity: "high",
      confidence: "high",
      evidence: [
        {
          type: "visual",
          text: "The subject's face visibly morphs between frames.",
          timestamp: "00:07",
        },
      ],
      explanation: "Severe AI visual morphing artifacts were detected.",
      suggested_correction:
        "Regenerate or replace the affected visual sections.",
      correction_type: "edit_recommendation",
      sub_checks: [
        {
          check_id: "ai_artifacts",
          name: "AI Artifacts Audit",
          result: "failed",
          severity: "high",
          explanation: "AI morphing artifacts detected.",
        },
      ],
    }),
  };

  const results = await runVisualQualityAgent(
    failingVisualQualityContext.request_id,
    deps,
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].metric_id, "production_readiness");
  assertEquals(results[0].agent, "visual_quality");
  assertEquals(results[0].result, "false");
  assertEquals(results[0].severity, "high");
});
