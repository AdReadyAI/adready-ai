/**
 * brief-alignment-agent/index.ts — Brief Alignment Agent
 *
 * Owned by: Yuchen Lin
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS:
 *
 *   1. audience_fit ("Does the video speak to the intended audience's needs, motivations, or context?")
 *      [ ] demographic_mismatch: Vocabulary, slang, music, or scene setups clash with demographic habit profile.
 *      [ ] demographic_restricted: Targets age-restricted or legally prohibited demographics.
 *
 *   2. brief_adherence ("Does the video satisfy the core campaign objective and required message from the creative brief?")
 *      [ ] objective_missed: Primary video goal deviates from objective (e.g. calls for conversion when objective is awareness).
 *      [ ] required_message_missing: Core mandatory messaging statements or features from creative brief are omitted.
 *
 * DB CONTEXT:
 *   - Orchestration invokes the agent with a request_id (AgentRunRequestSchema).
 *   - The agent loads its AgentContext from Supabase by request_id (see context.ts).
 *   - LLM calls go through shared/llm.ts (OPENROUTER_MODEL from env — no hardcoded model).
 */

import { createEdgeHandler, ok } from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";
import { loadAgentContext } from "./context.ts";
import { runBriefAlignmentAgent } from "./agent.ts";

createEdgeHandler(
  "brief-alignment-agent",
  AgentRunRequestSchema,
  async (_req, ctx) => {
    const context = await loadAgentContext(ctx.body.request_id);
    const results = await runBriefAlignmentAgent(context);
    return ok(results);
  },
);
