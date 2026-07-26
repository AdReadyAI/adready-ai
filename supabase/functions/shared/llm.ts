/**
 * llm.ts — Shared LLM client via OpenRouter.
 *
 * Model-agnostic. Any model available on OpenRouter can be used.
 * Model selection should be confirmed with the eval science team
 * based on cost and performance testing.
 *
 * Required env vars:
 *   OPENROUTER_API_KEY  — API key from openrouter.ai
 *   OPENROUTER_MODEL
 * Optional env var:
 *   OPENROUTER_BASE_URL — defaults to the OpenRouter chat-completions endpoint
 */

function openRouterBaseUrl(): string {
  return Deno.env.get("OPENROUTER_BASE_URL") ??
    "https://openrouter.ai/api/v1/chat/completions";
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMResponse = {
  choices: { message: { content: string } }[];
};

/** Measure the exact encoded message payload for prompt-size telemetry. */
export function chatPayloadBytes(messages: ChatMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength;
}

/**
 * Strips markdown code fences from a model reply.
 *
 * Models routinely wrap JSON in ```json … ``` even when the prompt asks for
 * bare JSON, which makes the reply fail JSON.parse. Returns the fenced content
 * when a fence is present, otherwise the trimmed reply unchanged.
 *
 * No provider-side JSON mode is requested anywhere in this client — response
 * format support varies by model, and this stays model-agnostic by design.
 */
export function stripCodeFences(reply: string): string {
  const trimmed = reply.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Sends messages to the configured model via OpenRouter and returns the reply.
 */
export async function chat(messages: ChatMessage[], model?: string): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
 
  const resolvedModel = model ?? Deno.env.get("OPENROUTER_MODEL");
  if (!resolvedModel) {
    throw new Error(
      "No model configured: pass a model argument to chat(), or set OPENROUTER_MODEL.",
    );
  }
 
  const res = await fetch(openRouterBaseUrl(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: resolvedModel, messages }),
  });
 
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }
 
  const data: LLMResponse = await res.json();
  return data.choices[0].message.content;
}