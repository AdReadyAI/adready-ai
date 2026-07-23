/**
 * response_schemas.ts — Zod schemas for the Storyline agent's two LLM replies.
 *
 * Call 1 returns the narrative arc (derivation only). Call 2 returns the four
 * LLM sub-check verdicts plus the pacing judgment, and the creative_effectiveness
 * metric-level fields. Both are validated with these schemas; a reply that does
 * not match parses to null and the agent degrades to cannot_assess.
 */

import { z } from "zod";
import { ConfidenceLevelSchema } from "../shared/schemas.ts";

export const ARC_ROLES = [
  "hook",
  "problem",
  "solution",
  "proof",
  "payoff",
  "cta",
  "detour",
] as const;
export const ArcRoleSchema = z.enum(ARC_ROLES);
export type ArcRole = z.infer<typeof ArcRoleSchema>;

/** Call 1 — narrative structure (derivation), labeled over visual_frames. */
export const ArcLabelingSchema = z.object({
  arc: z.array(
    z.object({
      frame_id: z.string(),
      role: ArcRoleSchema,
      confidence: ConfidenceLevelSchema,
    }),
  ),
  unfilled_roles: z.array(z.string()),
  payoff_resolved_at: z.string().nullable(),
  overall_confidence: ConfidenceLevelSchema,
});
export type ArcLabeling = z.infer<typeof ArcLabelingSchema>;

// Call 2 uses the shared evaluation envelope (sub-check verdicts + metric fields).
export {
  type EvaluationResponse as StorylineEvaluation,
  EvaluationResponseSchema as StorylineEvaluationSchema,
} from "../shared/llm_eval.ts";
