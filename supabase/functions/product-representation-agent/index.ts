/** Internal Edge Function adapter for the Product Representation evaluator. */

import { createEvaluatorHandler, loadAgentContext } from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runProductRepresentationAgent } from "./agent.ts";

/**
 * Migration 044 invokes this function with INTERNAL_TRIGGER_SECRET after Media
 * Processing completes. Authentication, request parsing, and generic error
 * responses remain inside the shared internal handler.
 */
createEvaluatorHandler(
  "product-representation-agent",
  "product_representation",
  AgentRunRequestSchema,
  async (context) => {
    const requestId = context.body.request_id;
    const agentContext = await loadAgentContext(requestId);
    return await runProductRepresentationAgent(agentContext);
  },
);
