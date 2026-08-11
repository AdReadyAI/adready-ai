/** Shared lifecycle wrapper for internally dispatched evaluator functions. */
import { z } from "zod";
import { createSupabaseServiceClient } from "./clients.ts";
import {
  createInternalEdgeHandler,
  type InternalHandlerContextWithBody,
} from "./handler.ts";
import { completeEvaluatorRun } from "./persist.ts";
import { err, ok } from "./response.ts";
import type { MetricResult } from "./schemas.ts";

type Evaluator<T extends { request_id: string }> = (
  context: InternalHandlerContextWithBody<T>,
) => Promise<MetricResult[]>;

/**
 * Serve one evaluator behind the durable Evaluator Run lifecycle.
 *
 * The adapter claims dispatched work before evaluation, completes lifecycle
 * state atomically with result persistence, and stores only a bounded error
 * category if evaluator code throws. Generic HTTP error handling remains in
 * the existing internal Edge Function wrapper.
 */
export function createEvaluatorHandler<T extends { request_id: string }>(
  endpointName: string,
  evaluatorName: string,
  schema: z.ZodType<T>,
  evaluate: Evaluator<T>,
): void {
  createInternalEdgeHandler(
    endpointName,
    schema,
    async (_request, context) => {
      const requestId = context.body.request_id;
      const supabase = createSupabaseServiceClient();
      const identity = {
        p_request_id: requestId,
        p_evaluator: evaluatorName,
      };
      const { data: started, error: startError } = await supabase.rpc(
        "mark_evaluator_run_started",
        identity,
      );

      if (startError) throw startError;
      if (!started) {
        return err(
          "EVALUATOR_RUN_NOT_AVAILABLE",
          "Evaluator Run is not available for processing",
          409,
        );
      }

      try {
        const results = await evaluate(context);
        await completeEvaluatorRun(requestId, evaluatorName, results);
        return ok(results);
      } catch (error) {
        // Error objects may contain prompts, evidence, provider responses, or
        // URLs. Persist only the local category; full detail stays in logs.
        const errorCode = error instanceof Error
          ? error.constructor.name
          : "EvaluatorError";
        const { error: failureError } = await supabase.rpc(
          "mark_evaluator_run_failed",
          {
            ...identity,
            p_error_code: errorCode,
            p_error: null,
          },
        );

        if (failureError) {
          console.error(`[${endpointName}] Failed to persist run failure:`, {
            request_id: requestId,
            evaluator: evaluatorName,
            error: failureError,
          });
        }
        throw error;
      }
    },
  );
}
