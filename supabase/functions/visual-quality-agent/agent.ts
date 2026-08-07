import { loadAgentContext, persistMetricResults } from "../shared/index.ts";
import { validateMetricResults } from "../shared/validation.ts";

import type { AgentRunRequest, MetricResult } from "../shared/schemas.ts";

import { auditVisualQuality } from "./visual-audit.ts";

import { evaluateProductionReadiness } from "./metrics.ts";

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
  request: AgentRunRequest,
): Promise<MetricResult> {
  const context = await loadAgentContext(request.request_id);

  const visualFindings = await auditVisualQuality(context);

  const [result] = validateMetricResults([
    evaluateProductionReadiness(
      context,
      visualFindings,
    ),
  ]);

  await persistMetricResults(
    context.request_id,
    [result],
  );

  return result;
}
