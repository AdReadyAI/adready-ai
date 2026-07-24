/**
 * context.ts — DB-backed AgentContext loader boundary for the Brief Alignment
 * agent.
 *
 * Under the shared architecture, orchestration invokes the agent with only a
 * request_id and the agent loads its working context from Supabase. The tables
 * that back AgentContext do not exist yet, so this loader is intentionally a
 * boundary: the evaluation logic already consumes AgentContext, only the DB read
 * is pending. Throwing a Response is caught by createEdgeHandler and returned
 * verbatim to the caller.
 */

import type { AgentContext } from "../shared/schemas.ts";

export function loadAgentContext(_requestId: string): Promise<AgentContext> {
  // TODO(db): load campaign context, parsed creative brief, transcript, OCR,
  // visual frames, and product frames from Supabase by request_id, then validate
  // with AgentContextSchema before returning.
  throw new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "AgentContext DB loading is not implemented yet",
      },
    }),
    { status: 501, headers: { "Content-Type": "application/json" } },
  );
}
