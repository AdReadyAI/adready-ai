import { AgentRunRequestSchema, MetricResultSchema } from "../shared/schemas.ts";
import type { AgentRunRequest, MetricResult } from "../shared/schemas.ts";
import { loadAgentContext } from "../shared/context.ts";
import { persistMetricResults } from "../shared/persist.ts";
import { buildBrandResult, evaluateLogoChecks } from "./checks.ts";
import { evaluateQualitativeChecks } from "./prompts.ts";

export const BrandAgentRequestSchema = AgentRunRequestSchema;
export type BrandAgentRequest = AgentRunRequest;
export type BrandAgentRunOptions = { userId?: string };

/** Runs the Brand Alignment pipeline independently of HTTP transport. */
export async function runBrandAlignment(
  request: BrandAgentRequest,
  options: BrandAgentRunOptions = {},
): Promise<MetricResult> {
  const userId = options.userId ?? "";
  const context = await loadAgentContext(request.request_id, { userId });
  const logo = evaluateLogoChecks(context);
  const qualitative = await evaluateQualitativeChecks(context);
  const result = MetricResultSchema.parse(buildBrandResult(logo, qualitative));

  await persistMetricResults(context.request_id, [result]);
  return result;
}
