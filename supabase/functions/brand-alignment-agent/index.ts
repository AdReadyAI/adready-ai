import { createEdgeHandler, err, ok } from "../shared/index.ts";
import { BrandAgentRequestSchema, runBrandAlignment } from "./agent.ts";

createEdgeHandler(
  "brand-alignment-agent",
  BrandAgentRequestSchema,
  async (_req, ctx) => {
    try {
      return ok([await runBrandAlignment(ctx.body, { userId: ctx.user.id })]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // loadAgentContext throws "X was not found for this request." when the
      // request_id doesn't exist or doesn't belong to the authenticated user.
      const isNotFound = /not found for this request/i.test(message);
      console.error("[brand-alignment-agent] unhandled error", {
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
