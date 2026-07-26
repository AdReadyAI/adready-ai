/**
 * response_schemas.ts — Zod schemas for the CTA agent's two LLM replies.
 *
 * Call 1 (acquisition) returns the canonical CTA list plus a presence flag —
 * the agent re-reads transcript/OCR here so it never treats an empty
 * detected_ctas[] as proof of absence. Call 2 uses the shared evaluation
 * envelope. A reply that does not match parses to null and the agent degrades.
 */

import { z } from "zod";
import { ConfidenceLevelSchema } from "../shared/schemas.ts";

/**
 * Call 1 — CTA acquisition (derivation). CTAs are derived from transcript and
 * OCR (there is no detected_ctas primitive), and each carries the numeric
 * start_ms/end_ms of the segment it was found in, so the positional checks stay
 * deterministic arithmetic over those timestamps.
 */
export const CtaAcquisitionSchema = z.object({
  ctas: z.array(
    z.object({
      text: z.string(),
      source: z.enum(["audio", "on_screen", "visual"]),
      start_ms: z.number().int().nonnegative(),
      end_ms: z.number().int().nonnegative(),
      explicit: z.boolean(),
    }),
  ),
  cta_present: z.boolean(),
  overall_confidence: ConfidenceLevelSchema,
});
export type CtaAcquisition = z.infer<typeof CtaAcquisitionSchema>;
export type AcquiredCta = CtaAcquisition["ctas"][number];

// Call 2 uses the shared evaluation envelope (sub-check verdicts + metric fields).
export {
  type EvaluationResponse as CtaEvaluation,
  EvaluationResponseSchema as CtaEvaluationSchema,
} from "../shared/evaluator/llm_eval.ts";
