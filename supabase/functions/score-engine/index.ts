/**
 * Thin Edge Function: score-engine
 *
 * Stateless HTTP wrapper around the shared Score Engine v0.3.
 * Does not write to Postgres or invoke agents.
 * For DB import + persist of result tables, use score-result instead.
 *
 * POST /functions/v1/score-engine
 * Body: { "metric_results": MetricInput[] }
 * Requires user Bearer JWT (see functions/shared createEdgeHandler).
 */
import { z } from "zod";
import {
  parseScoreEngineRequest,
  scoreEngine,
} from "../shared/score-engine/index.ts";
import { createEdgeHandler } from "../shared/handler.ts";
import { err, ok } from "../shared/response.ts";

const RequestSchema = z.object({
  metric_results: z.array(z.record(z.unknown())),
});

createEdgeHandler("score-engine", RequestSchema, (_req, ctx) => {
  const parsed = parseScoreEngineRequest(ctx.body);
  if (!parsed.ok) {
    return Promise.resolve(err("VALIDATION_ERROR", parsed.error, 400));
  }

  return Promise.resolve(ok(scoreEngine(parsed.metric_results)));
});
