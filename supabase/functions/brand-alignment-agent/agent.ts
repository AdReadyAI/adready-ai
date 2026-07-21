import {
  AgentRunRequestSchema,
  MetricResultSchema,
} from "../shared/schemas.ts";
import type { AgentRunRequest, MetricResult } from "../shared/schemas.ts";
import { buildBrandResult, evaluateLogoChecks } from "./checks.ts";
import { evaluateQualitativeChecks } from "./prompts.ts";
import { loadBrandContext, persistBrandResult } from "./repository.ts";

export const BrandAgentRequestSchema = AgentRunRequestSchema;
export type BrandAgentRequest = AgentRunRequest;
export type BrandAgentRunOptions = { userId?: string };

/** Runs the Brand Alignment pipeline independently of HTTP transport. */
export async function runBrandAlignment(
  request: BrandAgentRequest,
  options: BrandAgentRunOptions = {},
): Promise<MetricResult> {
  const context = await loadBrandContext(
    request.request_id,
    request.video_id,
    options.userId,
  );
  const logo = evaluateLogoChecks(context);
  const qualitative = await evaluateQualitativeChecks(context);
  const result = MetricResultSchema.parse(buildBrandResult(logo, qualitative));

  await persistBrandResult(context.request_id, context.video_id, result);
  return result;
}
