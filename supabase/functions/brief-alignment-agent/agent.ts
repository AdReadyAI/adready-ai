/** Brief Alignment evaluation orchestration. */

import { chat, type ChatMessage, chatPayloadBytes } from "../shared/llm.ts";
import type { AgentContext, MetricResult } from "../shared/schemas.ts";
import { validateMetricResults } from "../shared/validation.ts";

import { buildBriefAlignmentResults } from "./checks.ts";
import { briefAlignmentPrompt } from "./prompts.ts";
import { parseBriefAlignmentResponse } from "./response_schemas.ts";

/** Injectable model seam used by unit tests and future model adapters. */
export type BriefAlignmentChat = (
  messages: ChatMessage[],
) => Promise<string>;

/**
 * Evaluate Brief Adherence and Audience Fit from a shared AgentContext.
 *
 * Provider failures and invalid responses become controlled `cannot_assess`
 * results so the one-shot evaluator pipeline still receives its canonical rows.
 */
export async function runBriefAlignmentAgent(
  context: AgentContext,
  chatFn: BriefAlignmentChat = chat,
): Promise<MetricResult[]> {
  const messages = briefAlignmentPrompt(context);
  let modelResponse = null;
  try {
    const rawResponse = await chatFn(messages);
    modelResponse = parseBriefAlignmentResponse(rawResponse);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "brief_alignment.provider_failed",
        request_id: context.request_id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const results = buildBriefAlignmentResults(context, modelResponse);

  console.info(
    JSON.stringify({
      event: "brief_alignment.completed",
      request_id: context.request_id,
      prompt_bytes: chatPayloadBytes(messages),
      response_parsed: modelResponse !== null,
    }),
  );

  return validateMetricResults(results);
}
