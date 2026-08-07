/**
 * Internal compatibility adapter for rebuilding one Launch-Readiness Scorecard.
 */
import { z } from "zod";
import { createInternalEdgeHandler } from "../shared/handler.ts";
import { err, ok } from "../shared/response.ts";
import { projectLaunchReadinessScorecard } from "./projection.ts";

const RequestSchema = z.object({
  request_id: z.string().uuid(),
  batch_id: z.string().uuid(),
});

createInternalEdgeHandler("score-result", RequestSchema, async (_req, ctx) => {
  const { request_id, batch_id } = ctx.body;
  const projection = await projectLaunchReadinessScorecard(
    request_id,
    batch_id,
  );
  if (!projection.ok) {
    return err(
      projection.code,
      projection.message,
      projection.status,
    );
  }

  return ok({
    request_id,
    batch_id,
    result_table: projection.resultTable,
  });
});
