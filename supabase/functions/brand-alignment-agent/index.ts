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

import { createInternalEdgeHandler, err, ok } from "../shared/index.ts";

import { BrandAgentRequestSchema, runBrandAlignment } from "./agent.ts";

createInternalEdgeHandler(
  "brand-alignment-agent",
  BrandAgentRequestSchema,
  async (_req, ctx) => {
    try {
      return ok([
        await runBrandAlignment(ctx.body),
      ]);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
        ? JSON.stringify(error)
        : String(error);
      const isNotFound = /not found for this request/i.test(message);

      console.error("[brand-alignment-agent] Execution failed:", {
        request_id: ctx.body.request_id,
        error: message,
        status: isNotFound ? 404 : 500,
      });

      if (isNotFound) {
        return err("REQUEST_NOT_FOUND", "Request not found.", 404);
      }

      return err(
        "BRAND_ALIGNMENT_FAILED",
        "Unexpected brand alignment failure.",
        500,
      );
    }
  },
);
