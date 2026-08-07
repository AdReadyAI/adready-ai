import { z } from "zod";
import { createEdgeHandler } from "../shared/index.ts";
import { projectCurrentIssues } from "./projection.ts";

const ProcessIssuesSchema = z
  .object({
    request_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
  })
  .refine((data) => data.request_id || data.batch_id, {
    message: "Provide either request_id or batch_id",
  });

type ProcessIssuesInput = z.infer<typeof ProcessIssuesSchema>;

/**
 * User-session entry point for manually rebuilding issues owned by the caller.
 */
createEdgeHandler<ProcessIssuesInput>(
  "process-issues",
  ProcessIssuesSchema,
  async (_req, { body, user }) =>
    await projectCurrentIssues({
      requestId: body.request_id,
      batchId: body.batch_id,
      userId: user.id,
    }),
);
