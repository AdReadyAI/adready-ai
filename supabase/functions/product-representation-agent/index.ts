/**
 * product-representation-agent/index.ts — Product Representation Agent
 *
 * Owned by: Yuchen Lin
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS:
 *
 *   1. product_clarity ("Can a viewer clearly identify what product is being advertised?")
 *      [ ] product_not_shown: Product packaging or product unit never visible.
 *      [ ] product_obscured: Product is in frame but heavily hidden, cropped, or too tiny to notice.
 *      [ ] product_appearance_wrong: Product color, label design, or shape does not match reference assets.
 *      [ ] product_name_unspoken: Brand or product name is never voiced or displayed in overlay text.
 *      [ ] insufficient_visibility: Deterministic screen-time coverage check (computed, not model-graded).
 *
 * DB CONTEXT:
 *   - Orchestration invokes the agent with a request_id (AgentRunRequestSchema).
 *   - The agent loads its AgentContext from Supabase by request_id via the shared
 *     ownership-checked loader (shared/context.ts).
 *   - LLM calls go through shared/llm.ts (OPENROUTER_MODEL from env — no hardcoded model).
 *   - Results are validated and persisted to agent_results (+ evidence,
 *     sub_checks) via shared/persist.ts.
 */

import {
  createEdgeHandler,
  loadAgentContext,
  ok,
  persistMetricResults,
} from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";
import { runProductRepresentationAgent } from "./agent.ts";

createEdgeHandler(
  "product-representation-agent",
  AgentRunRequestSchema,
  async (_req, ctx) => {
    const requestId = ctx.body.request_id;
    const context = await loadAgentContext(requestId, { userId: ctx.user.id });
    const results = await runProductRepresentationAgent(context);
    await persistMetricResults(requestId, results);
    return ok(results);
  },
);
