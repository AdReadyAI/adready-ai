/**
 * llm_client.ts — Injectable LLM seam.
 *
 * `shared/llm.ts` exposes a bare `chat()` module function bound to OpenRouter.
 * That is not testable in isolation: an agent that calls it directly cannot be
 * unit-tested without stubbing the network. This interface wraps it so every
 * agent depends on an `LlmClient` value it is *given*, letting tests inject a
 * scripted client and assert both the responses consumed and the number of
 * calls made. Production wiring passes `defaultLlmClient`.
 */

import { chat, type ChatMessage } from "../llm.ts";

export type { ChatMessage };

export interface LlmClient {
  /** Send messages to the model and return its raw text reply. */
  chat(messages: ChatMessage[]): Promise<string>;
}

/** The real client: delegates to the OpenRouter-backed `chat()` in llm.ts. */
export const defaultLlmClient: LlmClient = {
  chat: (messages) => chat(messages),
};
