/** Product Representation evaluation orchestration. */

import { chat, type ChatMessage, chatPayloadBytes } from "../shared/llm.ts";
import type { AgentContext, MetricResult } from "../shared/schemas.ts";
import { validateMetricResults } from "../shared/validation.ts";

import { buildProductRepresentationResults } from "./checks.ts";
import { productRepresentationPrompt } from "./prompts.ts";
import { parseProductRepresentationResponse } from "./response_schemas.ts";

/** Injectable model seam used by unit tests and future model adapters. */
export type ProductRepresentationChat = (
  messages: ChatMessage[],
) => Promise<string>;

/**
 * Evaluate Product Clarity from a shared AgentContext.
 *
 * Provider failures and invalid responses become a controlled `cannot_assess`
 * result so the one-shot evaluator pipeline still receives its canonical row.
 */
export async function runProductRepresentationAgent(
  context: AgentContext,
  chatFn: ProductRepresentationChat = chat,
): Promise<MetricResult[]> {
  const messages = productRepresentationPrompt(context);
  let modelResponse = null;
  try {
    const rawResponse = await chatFn(messages);
    modelResponse = parseProductRepresentationResponse(rawResponse);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "product_representation.provider_failed",
        request_id: context.request_id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const results = buildProductRepresentationResults(context, modelResponse);

  console.info(
    JSON.stringify({
      event: "product_representation.completed",
      request_id: context.request_id,
      prompt_bytes: chatPayloadBytes(messages),
      response_parsed: modelResponse !== null,
    }),
  );

  return validateMetricResults(results);
}
