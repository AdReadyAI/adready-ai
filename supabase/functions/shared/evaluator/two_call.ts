/**
 * two_call.ts — The two-call evaluation pattern shared by every evaluator agent.
 *
 * The spec is strict about call structure: each agent makes *exactly two* LLM
 * calls per run —
 *
 *   Call 1 (derivation): establishes what the ad IS (its narrative arc, or its
 *                        canonical CTA list). No severity, no judgment.
 *   Call 2 (evaluation): runs every LLM sub-check for the agent in ONE prompt,
 *                        reading Call 1's output, and returns finished results.
 *
 * Sub-checks are sections of Call 2's single prompt, never separate calls. This
 * abstraction makes that structural rather than a matter of discipline: an agent
 * expressed as a `TwoCallFlow` and run through `runTwoCall` issues precisely two
 * `llm.chat` calls and physically cannot fan out into N-calls-per-sub-check.
 *
 * The parse steps must never throw — a malformed model reply degrades to a
 * `cannot_assess`-shaped derivation/evaluation (each agent defines what that is),
 * so a bad response never crashes the run. `runTwoCall` itself stays agnostic to
 * that; it only guarantees the call structure and the derivation → evaluation
 * data flow.
 */

import type { ChatMessage, LlmClient } from "./llm_client.ts";

export interface TwoCallFlow<Input, Derivation, Evaluation> {
  /** Build Call 1's messages from the agent input. */
  derivationPrompt(input: Input): ChatMessage[];
  /** Parse Call 1's raw reply into a derivation. Must not throw; degrades. */
  parseDerivation(raw: string): Derivation;
  /** Build Call 2's messages from the input and Call 1's derivation. */
  evaluationPrompt(input: Input, derivation: Derivation): ChatMessage[];
  /** Parse Call 2's raw reply into an evaluation. Must not throw; degrades. */
  parseEvaluation(raw: string): Evaluation;
}

export type TwoCallResult<Derivation, Evaluation> = {
  derivation: Derivation;
  evaluation: Evaluation;
};

/**
 * Run a two-call flow: derive, then evaluate reading the derivation. Issues
 * exactly two `llm.chat` calls, in order.
 */
export async function runTwoCall<Input, Derivation, Evaluation>(
  llm: LlmClient,
  flow: TwoCallFlow<Input, Derivation, Evaluation>,
  input: Input,
): Promise<TwoCallResult<Derivation, Evaluation>> {
  const derivationRaw = await llm.chat(flow.derivationPrompt(input));
  const derivation = flow.parseDerivation(derivationRaw);

  const evaluationRaw = await llm.chat(
    flow.evaluationPrompt(input, derivation),
  );
  const evaluation = flow.parseEvaluation(evaluationRaw);

  return { derivation, evaluation };
}
