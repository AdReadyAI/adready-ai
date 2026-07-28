import {
  AgentRunRequestSchema,
  MetricResultSchema,
} from "../shared/schemas.ts";

import type {
  AgentRunRequest,
  MetricResult,
} from "../shared/schemas.ts";

import {
  loadVisualQualityContext,
  persistVisualQualityResult,
} from "./repository.ts";

import {
  auditVisualQuality,
} from "./visual-audit.ts";

import {
  evaluateProductionReadiness,
} from "./metrics.ts";

export const VisualQualityAgentRequestSchema =
  AgentRunRequestSchema;

export type VisualQualityAgentRequest =
  AgentRunRequest;

export type VisualQualityAgentRunOptions = {
  userId?: string;
};

/**
 * Runs the Visual Quality Agent pipeline.
 *
 * 1. Loads the request context from the database.
 * 2. Runs the LLM-assisted visual audit.
 * 3. Evaluates all six production-readiness checks.
 * 4. Builds the final production_readiness metric.
 * 5. Persists the result and sub-checks.
 */
export async function runVisualQualityAgent(
  request: VisualQualityAgentRequest,
  options: VisualQualityAgentRunOptions = {},
): Promise<MetricResult> {
  const context = await loadVisualQualityContext(
    request.request_id,
    options.userId,
  );

  const visualFindings = await auditVisualQuality(
    context,
  );

  const result = MetricResultSchema.parse(
    evaluateProductionReadiness(
      context,
      visualFindings,
    ),
  );

  await persistVisualQualityResult(
    context.request_id,
    result,
  );

  return result;
}