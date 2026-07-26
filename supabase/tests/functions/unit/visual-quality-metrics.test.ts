import { assertEquals } from "@std/assert";

import { evaluateProductionReadiness } from "../../../functions/visual-quality-agent/metrics.ts";
import type { ProductionReadinessChecks } from "../../../functions/visual-quality-agent/types.ts";

import {
  cleanVisualQualityContext,
} from "./test-fixtures/visual-quality-fixtures.ts";

Deno.test("visual-quality-metrics: passes when all checks pass", () => {
  const checks: ProductionReadinessChecks = {
    video_corruption: {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    dropped_frames: {
      check_id: "dropped_frames",
      name: "Frame Sync Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    ai_artifacts: {
      check_id: "ai_artifacts",
      name: "AI Artifacts Audit",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    poor_framing_lighting: {
      check_id: "poor_framing_lighting",
      name: "Framing and Lighting Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    jarring_transitions: {
      check_id: "jarring_transitions",
      name: "Transition Continuity Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    illegible_text: {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },
  };

  const result = evaluateProductionReadiness(
    cleanVisualQualityContext,
    checks,
  );

  assertEquals(result.metric_id, "production_readiness");
  assertEquals(result.result, "true");
  assertEquals(result.severity, "none");
  assertEquals(result.confidence, "high");
  assertEquals(result.sub_checks?.length, 6);
});

Deno.test("visual-quality-metrics: fails when AI artifacts are detected", () => {
  const checks: ProductionReadinessChecks = {
    video_corruption: {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    dropped_frames: {
      check_id: "dropped_frames",
      name: "Frame Sync Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    ai_artifacts: {
      check_id: "ai_artifacts",
      name: "AI Artifacts Audit",
      result: "failed",
      severityScore: 3,
      explanation: "Severe AI morphing artifacts detected.",
      confidence_score: 0.95,
    },

    poor_framing_lighting: {
      check_id: "poor_framing_lighting",
      name: "Framing and Lighting Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    jarring_transitions: {
      check_id: "jarring_transitions",
      name: "Transition Continuity Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    illegible_text: {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },
  };

  const result = evaluateProductionReadiness(
    cleanVisualQualityContext,
    checks,
  );

  assertEquals(result.result, "false");
  assertEquals(result.severity, "high");
  assertEquals(result.sub_checks?.length, 6);
  assertEquals(result.sub_checks?.[2].result, "failed");
  assertEquals(result.sub_checks?.[2].severity, "high");
});

Deno.test("visual-quality-metrics: highest failed severity determines overall severity", () => {
  const checks: ProductionReadinessChecks = {
    video_corruption: {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    dropped_frames: {
      check_id: "dropped_frames",
      name: "Frame Sync Check",
      result: "failed",
      severityScore: 1,
      confidence_score: 0.8,
    },

    ai_artifacts: {
      check_id: "ai_artifacts",
      name: "AI Artifacts Audit",
      result: "failed",
      severityScore: 3,
      explanation: "Severe AI artifacts detected.",
      confidence_score: 0.9,
    },

    poor_framing_lighting: {
      check_id: "poor_framing_lighting",
      name: "Framing and Lighting Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    jarring_transitions: {
      check_id: "jarring_transitions",
      name: "Transition Continuity Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },

    illegible_text: {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "passed",
      severityScore: 0,
      confidence_score: 1,
    },
  };

  const result = evaluateProductionReadiness(
    cleanVisualQualityContext,
    checks,
  );

  assertEquals(result.result, "false");
  assertEquals(result.severity, "high");
});

Deno.test("visual-quality-metrics: returns cannot_assess when all checks cannot be assessed", () => {
  const checks: ProductionReadinessChecks = {
    video_corruption: {
      check_id: "video_corruption",
      name: "File Integrity",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
    },

    dropped_frames: {
      check_id: "dropped_frames",
      name: "Frame Sync Check",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
    },

    ai_artifacts: {
      check_id: "ai_artifacts",
      name: "AI Artifacts Audit",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
    },

    poor_framing_lighting: {
      check_id: "poor_framing_lighting",
      name: "Framing and Lighting Check",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
    },

    jarring_transitions: {
      check_id: "jarring_transitions",
      name: "Transition Continuity Check",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
    },

    illegible_text: {
      check_id: "illegible_text",
      name: "Text Quality Check",
      result: "cannot_assess",
      severityScore: 0,
      confidence_score: 0,
    },
  };

  const result = evaluateProductionReadiness(
    cleanVisualQualityContext,
    checks,
  );

  assertEquals(result.result, "cannot_assess");
  assertEquals(result.severity, "cannot_assess");
  assertEquals(result.confidence, "low");
});
