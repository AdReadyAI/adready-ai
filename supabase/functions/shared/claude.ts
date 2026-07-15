/**
 * claude.ts — Shared Anthropic client setup for all edge functions.
 */

import Anthropic from "npm:@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

// Model constants
export const HAIKU = "claude-3-haiku-20240307";
export const SONNET = "claude-3-5-sonnet-latest";
export const OPUS = "claude-3-opus-20240229";
