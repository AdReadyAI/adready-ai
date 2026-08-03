import { createEdgeHandler, err, ok } from "../shared/index.ts";
import { BrandAgentRequestSchema, runBrandAlignment } from "./agent.ts";

createEdgeHandler(
  "brand-alignment-agent",
  BrandAgentRequestSchema,
  async (_req, ctx) => {
    try {
      return ok([await runBrandAlignment(ctx.body, { userId: ctx.user.id })]);
    } catch (error) {
      console.error("[brand-alignment-agent] unhandled error", {
        request_id: ctx.body.request_id,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(
        "BRAND_ALIGNMENT_FAILED",
        "Unexpected brand alignment failure",
        500,
      );
    }
  },
);
