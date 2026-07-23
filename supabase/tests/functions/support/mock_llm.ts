/**
 * mock_llm.ts — Scripted LlmClient for tests (no network).
 *
 * Returns queued raw responses in order and records every call's messages, so a
 * test can assert both how many LLM calls happened and what each was prompted
 * with. Shared by unit and integration tests. Never makes a real API call.
 */

import type {
  ChatMessage,
  LlmClient,
} from "../../../functions/shared/llm_client.ts";

export type ScriptedLlm = LlmClient & {
  /** Messages passed to each `chat` call, in call order. */
  readonly calls: ChatMessage[][];
  /** Number of `chat` calls made so far. */
  readonly callCount: number;
};

/**
 * Build a scripted client. `responses` are returned one per `chat` call, in
 * order; once exhausted, further calls return `overflow` (default "") so an
 * accidental extra call is observable via `callCount` rather than throwing.
 */
export function scriptedLlm(responses: string[], overflow = ""): ScriptedLlm {
  const calls: ChatMessage[][] = [];
  let index = 0;

  return {
    calls,
    get callCount() {
      return calls.length;
    },
    chat(messages: ChatMessage[]): Promise<string> {
      calls.push(messages);
      const response = index < responses.length ? responses[index] : overflow;
      index++;
      return Promise.resolve(response);
    },
  };
}
