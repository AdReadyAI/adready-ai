/**
 * claude.ts — Shared OpenRouter (OpenAI-compatible) client setup for all edge functions.
 *
 * The client is constructed lazily (only on first real use) so that importing
 * this module — which every agent's agent.ts/index.ts does, even under test
 * with a fully mocked client — never requires OPENROUTER_API_KEY to be set.
 */

import OpenAI from "npm:openai";

let _openrouter: OpenAI | undefined;

export function getOpenRouterClient(): OpenAI {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }
  return _openrouter;
}

// Model constants (OpenRouter model IDs)
export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.5";
export const OPUS = "anthropic/claude-opus-4.5";
