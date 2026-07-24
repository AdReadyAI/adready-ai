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
 *   - The agent loads its AgentContext (product frames, logo frames, visual
 *     frames, transcript, OCR, product context, and video metadata) from Supabase
 *     by request_id.
 *   - See context.ts for the DB loader boundary (pending the backing tables).
 */

import { createEdgeHandler, ok } from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";
import { loadAgentContext } from "./context.ts";
import { getOpenRouterClient, SONNET } from "./llm.ts";
import { type ChatClient, runProductRepresentationAgent } from "./agent.ts";

createEdgeHandler(
  "product-representation-agent",
  AgentRunRequestSchema,
  async (_req, ctx) => {
    const context = await loadAgentContext(ctx.body.request_id);
    const client = getOpenRouterClient() as unknown as ChatClient;
    const model = Deno.env.get("OPENROUTER_MODEL") ?? SONNET;
    const results = await runProductRepresentationAgent(context, client, model);
    return ok(results);
  },
);
