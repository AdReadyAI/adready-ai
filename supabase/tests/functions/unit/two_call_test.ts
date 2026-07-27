/**
 * Unit tests for the two-call flow runner (_evaluator/two_call.ts) and the
 * LlmClient seam (_evaluator/llm_client.ts).
 *
 * The load-bearing guarantee: a flow run through runTwoCall makes EXACTLY two
 * LLM calls — the spec forbids sub-checks becoming N separate calls. Pure logic
 * with a scripted client; no network.
 */

import { assertEquals } from "@std/assert";
import {
  runTwoCall,
  type TwoCallFlow,
} from "../../../functions/_evaluator/two_call.ts";
import { defaultLlmClient } from "../../../functions/_evaluator/llm_client.ts";
import type { ChatMessage } from "../../../functions/_evaluator/llm_client.ts";
import { scriptedLlm } from "../support/mock_llm.ts";

/** A minimal flow: derive a number, then echo it into the evaluation prompt. */
type Input = { seed: string };
type Derivation = { value: number };
type Evaluation = { doubled: number };

function makeFlow(): TwoCallFlow<Input, Derivation, Evaluation> {
  return {
    derivationPrompt: (
      input,
    ) => [{ role: "user", content: `derive:${input.seed}` }],
    parseDerivation: (raw) => ({ value: Number(raw) }),
    evaluationPrompt: (_input, derivation) => [
      { role: "user", content: `evaluate:${derivation.value}` },
    ],
    parseEvaluation: (raw) => ({ doubled: Number(raw) }),
  };
}

Deno.test("runTwoCall makes exactly two LLM calls", async () => {
  const llm = scriptedLlm(["7", "14"]);
  await runTwoCall(llm, makeFlow(), { seed: "x" });
  assertEquals(llm.callCount, 2);
});

Deno.test("runTwoCall calls derivation first, then evaluation", async () => {
  const llm = scriptedLlm(["7", "14"]);
  await runTwoCall(llm, makeFlow(), { seed: "abc" });
  assertEquals(llm.calls[0][0].content, "derive:abc");
  assertEquals(llm.calls[1][0].content, "evaluate:7"); // derivation fed into call 2
});

Deno.test("runTwoCall returns both parsed derivation and evaluation", async () => {
  const llm = scriptedLlm(["7", "14"]);
  const out = await runTwoCall(llm, makeFlow(), { seed: "x" });
  assertEquals(out.derivation, { value: 7 });
  assertEquals(out.evaluation, { doubled: 14 });
});

Deno.test("an extra LLM call would be observable (guards against N-call fan-out)", async () => {
  // The runner only ever calls chat twice; a third scripted response is unused.
  const llm = scriptedLlm(["7", "14", "SHOULD-NOT-BE-USED"]);
  await runTwoCall(llm, makeFlow(), { seed: "x" });
  assertEquals(llm.callCount, 2);
  assertEquals(
    llm.calls.every((m) => m[0].content !== "SHOULD-NOT-BE-USED"),
    true,
  );
});

Deno.test("defaultLlmClient exposes a chat method (production wiring)", () => {
  assertEquals(typeof defaultLlmClient.chat, "function");
  // Type-level: messages are ChatMessage[]. Constructing one must compile.
  const _msg: ChatMessage = { role: "system", content: "noop" };
});
