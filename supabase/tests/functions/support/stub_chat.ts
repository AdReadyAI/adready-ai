/**
 * stub_chat.ts — Hermetic stub for shared/llm.ts's `chat()`.
 *
 * The agents now call `chat()` (OpenRouter) directly rather than taking an
 * injected client, so tests stub the LLM by replacing `globalThis.fetch` with a
 * scripted queue of OpenRouter-shaped completions. No real network is ever made:
 * the request is intercepted before it leaves. `chat()` reads OPENROUTER_API_KEY
 * / OPENROUTER_MODEL, so the stub sets placeholder values when absent (hence the
 * test tasks run with --allow-env).
 *
 * Use `withChat` / `withChatFailure` so the original fetch is always restored,
 * even when an assertion throws.
 */

export type ChatStub = {
  /** Number of chat (fetch) calls made so far. */
  readonly callCount: number;
  /** Restore the original globalThis.fetch. */
  restore(): void;
};

function ensureEnv(): void {
  if (!Deno.env.get("OPENROUTER_API_KEY")) {
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
  }
  if (!Deno.env.get("OPENROUTER_MODEL")) {
    Deno.env.set("OPENROUTER_MODEL", "test/model");
  }
}

function completion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Install a scripted chat stub. `responses` are returned one per call, in order;
 * once exhausted, further calls return `overflow` (default "") so an accidental
 * extra call is observable via `callCount` rather than throwing.
 */
export function stubChat(responses: string[], overflow = ""): ChatStub {
  ensureEnv();
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = ((): Promise<Response> => {
    const content = count < responses.length ? responses[count] : overflow;
    count++;
    return Promise.resolve(completion(content));
  }) as typeof globalThis.fetch;
  return {
    get callCount() {
      return count;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Install a chat stub whose every call rejects (simulates total provider failure). */
export function stubChatFailure(message = "provider down"): ChatStub {
  ensureEnv();
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = ((): Promise<Response> => {
    count++;
    return Promise.reject(new Error(message));
  }) as typeof globalThis.fetch;
  return {
    get callCount() {
      return count;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Run `fn` with a scripted chat stub installed, always restoring fetch after. */
export async function withChat(
  responses: string[],
  fn: (stub: ChatStub) => Promise<void>,
): Promise<void> {
  const stub = stubChat(responses);
  try {
    await fn(stub);
  } finally {
    stub.restore();
  }
}

/** Run `fn` with a failing chat stub installed, always restoring fetch after. */
export async function withChatFailure(
  fn: (stub: ChatStub) => Promise<void>,
): Promise<void> {
  const stub = stubChatFailure();
  try {
    await fn(stub);
  } finally {
    stub.restore();
  }
}
