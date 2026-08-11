import {
  AgentRunRequestSchema,
  loadAgentContext,
  validateMetricResults,
} from "../shared/index.ts";

import type { AgentRunRequest, MetricResult } from "../shared/index.ts";

import { buildBrandResult, evaluateLogoChecks } from "./checks.ts";

import { evaluateQualitativeChecks } from "./prompts.ts";

export const BrandAgentRequestSchema = AgentRunRequestSchema;

export type BrandAgentRequest = AgentRunRequest;

/**
 * Runs the Brand Alignment evaluation pipeline.
 *
 * 1. Loads request context (creative brief, logo frames, visual frames, transcript, OCR).
 * 2. Evaluates deterministic logo presence and reference-match checks.
 * 3. Evaluates qualitative color palette and brand voice alignment.
 * 4. Returns validated output to the Edge Function lifecycle wrapper.
 */
export async function runBrandAlignment(
  request: BrandAgentRequest,
): Promise<MetricResult> {
  const context = await loadAgentContext(request.request_id);

  const logo = evaluateLogoChecks(context);
  const qualitative = await evaluateQualitativeChecks(context);
  const [result] = validateMetricResults([buildBrandResult(logo, qualitative)]);

  return result;
}
