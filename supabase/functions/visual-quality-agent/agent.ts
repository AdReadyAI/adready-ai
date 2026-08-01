import {
  AgentRunRequestSchema,
  MetricResultSchema,
} from "../shared/schemas.ts";

import type { AgentRunRequest, MetricResult } from "../shared/schemas.ts";

import { auditVisualQuality } from "./visual-audit.ts";

import { evaluateProductionReadiness } from "./metrics.ts";

import { loadAgentContext, persistMetricResults } from "../shared/index.ts";

export const VisualQualityAgentRequestSchema = AgentRunRequestSchema;

export type VisualQualityAgentRequest = AgentRunRequest;


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
  { userId }: { userId: string },
): Promise<MetricResult> {
  const context = await loadAgentContext(request.request_id, { userId });

  const visualFindings = await auditVisualQuality(context);

  const result = MetricResultSchema.parse(
    evaluateProductionReadiness(
      context,
      visualFindings,
    ),
  );

  await persistMetricResults(
    context.request_id,
    [result],
  );

  return result;
}
