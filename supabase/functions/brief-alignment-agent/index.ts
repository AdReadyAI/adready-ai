/** Internal Edge Function adapter for the Brief Alignment evaluator. */

import {
  createInternalEdgeHandler,
  loadAgentContext,
  ok,
  persistMetricResults,
} from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runBriefAlignmentAgent } from "./agent.ts";

/**
 * Migration 044 invokes this function with INTERNAL_TRIGGER_SECRET after Media
 * Processing completes. Authentication, request parsing, and generic error
 * responses remain inside the shared internal handler.
 */
createInternalEdgeHandler(
  "brief-alignment-agent",
  AgentRunRequestSchema,
  async (_request, context) => {
    const requestId = context.body.request_id;
    const agentContext = await loadAgentContext(requestId);
    const results = await runBriefAlignmentAgent(agentContext);

    await persistMetricResults(requestId, results);

    return ok(results);
  },
);
