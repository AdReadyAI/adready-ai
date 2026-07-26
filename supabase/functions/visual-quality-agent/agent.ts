/**
 * visual-quality-agent/agent.ts — Visual Quality Agent orchestration.
 *
 * Loads the agent context, runs visual analysis, converts all findings into
 * the six production-readiness checks, and synthesizes the final metric.
 *
 * Dependencies are injectable so the agent can be unit tested without
 * database access, environment variables, OpenRouter, or an LLM.
 */

import { MetricResultSchema } from "../shared/schemas.ts";
import type { MetricResult } from "../shared/schemas.ts";

import { evaluateProductionReadiness } from "./metrics.ts";

import { getAgentContext } from "./tools/context.ts";

import { auditVisualQuality } from "./tools/visual-audit.ts";

import { evaluateProductionChecks } from "./tools/production-checks.ts";

import type { VisualQualityDependencies } from "./types.ts";

export const visualQualityDependencies: VisualQualityDependencies = {
  getAgentContext,
  auditVisualQuality,
  evaluateProductionChecks,
  evaluateProductionReadiness,
};

export async function runVisualQualityAgent(
  requestId: string,
  deps: VisualQualityDependencies = visualQualityDependencies,
): Promise<MetricResult[]> {
  const context = await deps.getAgentContext(requestId);

  const visualFindings = await deps.auditVisualQuality(context);

  const checks = deps.evaluateProductionChecks(
    context,
    visualFindings,
  );

  const result = deps.evaluateProductionReadiness(
    context,
    checks,
  );

  return MetricResultSchema.array().parse([
    result,
  ]);
}
