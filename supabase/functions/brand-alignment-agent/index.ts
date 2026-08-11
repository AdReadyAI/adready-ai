/**
 * brand-alignment-agent/index.ts — Brand Alignment Agent
 *
 * MAPPED METRICS & SUB-CHECKS:
 *   1. brand_fit ("Does the ad's logo, visual identity, and voice align with the supplied brand guidance?")
 *      [ ] logo_absent: Required logo is missing from visual frames.
 *      [ ] logo_incorrect: Detected logo differs from approved brand reference.
 *      [ ] color_palette_off: Visual colors or typography drift from brand guidelines.
 *      [ ] brand_voice_drift: Audio transcript or on-screen copy drifts from specified brand voice.
 */

import { createEvaluatorHandler } from "../shared/index.ts";

import { BrandAgentRequestSchema, runBrandAlignment } from "./agent.ts";

createEvaluatorHandler(
  "brand-alignment-agent",
  "brand_alignment",
  BrandAgentRequestSchema,
  async (ctx) => [await runBrandAlignment(ctx.body)],
);
