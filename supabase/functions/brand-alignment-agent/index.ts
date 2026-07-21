import { createEdgeHandler, err, ok } from "../shared/index.ts";
import { BrandAgentRequestSchema, runBrandAlignment } from "./agent.ts";

createEdgeHandler(
  "brand-alignment-agent",
  BrandAgentRequestSchema,
  async (_req, ctx) => {
    try {
      return ok([await runBrandAlignment(ctx.body, { userId: ctx.user.id })]);
    } catch (error) {
      return err(
        "BRAND_ALIGNMENT_FAILED",
        error instanceof Error
          ? error.message
          : "Unexpected brand alignment failure",
        500,
      );
    }
  },
);
