/**
 * llm.ts — OpenRouter (OpenAI-compatible) client for the Product Representation
 * agent.
 *
 * This lives inside the agent folder rather than in shared/ because the agent
 * relies on OpenAI-style tool-forced calls, which the shared chat() helper does
 * not support. It is a thin fetch wrapper (no SDK dependency) exposing the same
 * chat.completions.create shape the agent's ChatClient expects. OPENROUTER_API_KEY
 * is only read when create() is actually invoked, so importing this module — even
 * under test with a fully mocked client — never requires it.
 */

type CreateParams = Record<string, unknown>;

type CreateResult = {
  choices: Array<{
    message: {
      tool_calls?: Array<{
        function: { name: string; arguments: string };
      }>;
    };
  }>;
};

export type OpenRouterClient = {
  chat: {
    completions: {
      create: (params: CreateParams) => Promise<CreateResult>;
    };
  };
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterClient(): OpenRouterClient {
  return {
    chat: {
      completions: {
        create: async (params: CreateParams): Promise<CreateResult> => {
          const apiKey = Deno.env.get("OPENROUTER_API_KEY");
          if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

          const res = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(params),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenRouter error ${res.status}: ${text}`);
          }

          return await res.json() as CreateResult;
        },
      },
    },
  };
}

// Model constants (OpenRouter model IDs).
export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.5";
export const OPUS = "anthropic/claude-opus-4.5";
