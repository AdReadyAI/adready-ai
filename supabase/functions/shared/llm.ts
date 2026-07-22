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

/**
 * Sends messages to the configured model via OpenRouter and returns the reply.
 */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const model = Deno.env.get("OPENROUTER_MODEL");
  if (!model) throw new Error("OPENROUTER_MODEL is not set");

  const res = await fetch(openRouterBaseUrl(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data: LLMResponse = await res.json();
  return data.choices[0].message.content;
}
