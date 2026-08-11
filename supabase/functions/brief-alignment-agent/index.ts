/** Internal Edge Function adapter for the Brief Alignment evaluator. */

import { createEvaluatorHandler, loadAgentContext } from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runBriefAlignmentAgent } from "./agent.ts";

/**
 * Migration 044 invokes this function with INTERNAL_TRIGGER_SECRET after Media
 * Processing completes. Authentication, request parsing, and generic error
 * responses remain inside the shared internal handler.
 */
createEvaluatorHandler(
  "brief-alignment-agent",
  "brief_alignment",
  AgentRunRequestSchema,
  async (context) => {
    const requestId = context.body.request_id;
    const agentContext = await loadAgentContext(requestId);
    return await runBriefAlignmentAgent(agentContext);
  },
);
