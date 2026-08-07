/**
 * Supabase-native completion adapter for one evaluated Ad Creative.
 *
 * Both projections run in-process so evaluation completion never crosses the
 * Railway media-processing seam or makes Edge-to-Edge HTTP calls.
 */
import { z } from "zod";
import { createSupabaseServiceClient } from "../shared/clients.ts";
import { createInternalEdgeHandler } from "../shared/handler.ts";
import { err, ok } from "../shared/response.ts";
import { projectCurrentIssues } from "../process-issues/projection.ts";
import { projectLaunchReadinessScorecard } from "../score-result/projection.ts";

const CompletionSchema = z.object({
  request_id: z.string().uuid(),
  batch_id: z.string().uuid(),
});

createInternalEdgeHandler(
  "complete-evaluation",
  CompletionSchema,
  async (_req, { body }) => {
    const supabase = createSupabaseServiceClient();
    const identity = {
      p_request_id: body.request_id,
      p_batch_id: body.batch_id,
    };
    const { data: started, error: startError } = await supabase.rpc(
      "mark_evaluation_completion_started",
      identity,
    );
    if (startError) {
      return err(
        "COMPLETION_START_FAILED",
        `Failed to start evaluation completion: ${startError.message}`,
        500,
      );
    }
    if (!started) {
      return err(
        "UNKNOWN_REQUEST",
        "request_id and batch_id do not identify an Ad Creative",
        400,
      );
    }

    const scorecard = await projectLaunchReadinessScorecard(
      body.request_id,
      body.batch_id,
    );
    if (!scorecard.ok) {
      await supabase.rpc("mark_evaluation_completion_finished", {
        ...identity,
        p_status: "failed",
        p_error: scorecard.message,
      });
      return err(scorecard.code, scorecard.message, scorecard.status);
    }

    const issuesResponse = await projectCurrentIssues({
      requestId: body.request_id,
      batchId: body.batch_id,
    });
    if (!issuesResponse.ok) {
      const issueError = await issuesResponse.clone().text();
      await supabase.rpc("mark_evaluation_completion_finished", {
        ...identity,
        p_status: "failed",
        p_error: issueError,
      });
      return issuesResponse;
    }

    const { data: completed, error: completionError } = await supabase.rpc(
      "mark_evaluation_completion_finished",
      {
        ...identity,
        p_status: "completed",
        p_error: null,
      },
    );
    if (completionError || !completed) {
      return err(
        "COMPLETION_STATUS_FAILED",
        "Projections succeeded but completion status could not be persisted",
        500,
      );
    }

    return ok({
      request_id: body.request_id,
      batch_id: body.batch_id,
      status: "completed",
    });
  },
);
