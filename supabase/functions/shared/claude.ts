/**
 * claude.ts — Shared OpenRouter (OpenAI-compatible) client setup for all edge functions.
 */

import OpenAI from "npm:openai";

export const openrouter = new OpenAI({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
  baseURL: "https://openrouter.ai/api/v1",
});

// Model constants (OpenRouter model IDs)
export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.5";
export const OPUS = "anthropic/claude-opus-4.5";
