/**
 * Internal orchestration entry point for rebuilding one Ad Creative's issues.
 *
 * The worker has no user session, so this endpoint authenticates the narrow
 * trigger secret and validates the request/batch pair before projecting data.
 */
import { z } from "zod";
import { createInternalEdgeHandler } from "../shared/handler.ts";
import { projectCurrentIssues } from "../process-issues/projection.ts";

const InternalIssueProjectionSchema = z.object({
  request_id: z.string().uuid(),
  batch_id: z.string().uuid(),
});

createInternalEdgeHandler(
  "process-issues-internal",
  InternalIssueProjectionSchema,
  async (_req, { body }) =>
    await projectCurrentIssues({
      requestId: body.request_id,
      batchId: body.batch_id,
    }),
);
