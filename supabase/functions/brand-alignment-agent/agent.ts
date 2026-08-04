import {
  AgentRunRequestSchema,
  loadAgentContext,
  persistMetricResults,
  validateMetricResults,
} from "../shared/index.ts";

import type { AgentRunRequest, MetricResult } from "../shared/index.ts";

import { buildBrandResult, evaluateLogoChecks } from "./checks.ts";

import { evaluateQualitativeChecks } from "./prompts.ts";

export const BrandAgentRequestSchema = AgentRunRequestSchema;

export type BrandAgentRequest = AgentRunRequest;

export type BrandAgentRunOptions = {
  userId: string;
};

/**
 * Runs the Brand Alignment evaluation pipeline.
 *
 * 1. Loads request context (creative brief, logo frames, visual frames, transcript, OCR).
 * 2. Evaluates deterministic logo presence and reference-match checks.
 * 3. Evaluates qualitative color palette and brand voice alignment.
 * 4. Rolls up sub-checks into the metric result and persists findings.
 */
export async function runBrandAlignment(
  request: BrandAgentRequest,
  options: BrandAgentRunOptions,
): Promise<MetricResult> {
  const { userId } = options;
  const context = await loadAgentContext(request.request_id, { userId });

  const logo = evaluateLogoChecks(context);
  const qualitative = await evaluateQualitativeChecks(context);
  const [result] = validateMetricResults([buildBrandResult(logo, qualitative)]);

  await persistMetricResults(context.request_id, [result]);

  return result;
}
