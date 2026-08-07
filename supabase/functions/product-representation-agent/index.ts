/** Internal Edge Function adapter for the Product Representation evaluator. */

import {
  createInternalEdgeHandler,
  loadAgentContext,
  ok,
  persistMetricResults,
} from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runProductRepresentationAgent } from "./agent.ts";

/**
 * Migration 044 invokes this function with INTERNAL_TRIGGER_SECRET after Media
 * Processing completes. Authentication, request parsing, and generic error
 * responses remain inside the shared internal handler.
 */
createInternalEdgeHandler(
  "product-representation-agent",
  AgentRunRequestSchema,
  async (_request, context) => {
    const requestId = context.body.request_id;
    const agentContext = await loadAgentContext(requestId);
    const results = await runProductRepresentationAgent(agentContext);

    await persistMetricResults(requestId, results);

    return ok(results);
  },
);
