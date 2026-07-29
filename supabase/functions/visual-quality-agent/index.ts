/**
 * visual-quality-agent/index.ts — Visual Quality Agent
 *
 * Owned by: Saifeddine Rejeb
 *
 * MAPPED METRICS & INTERNAL SUB-CHECKS (Mental Checklist):
 *
 *   1. production_readiness ("Is the video technically complete enough to be reviewed or launched?")
 *      [ ] video_corruption: Video file is unplayable or corrupt (marked by metadata gate).
 *      [ ] dropped_frames: Stuttering, lag, or dropped frames occur frequently.
 *      [ ] ai_artifacts: Melting structures, extra fingers/limbs, or visual morphing distortions.
 *      [ ] poor_framing_lighting: Dark, overexposed lighting, or crucial subjects cropped out.
 *      [ ] jarring_transitions: Inconsistent color grade, flash frames, or cut mismatch at scene boundaries.
 *      [ ] illegible_text: Rendered caption fonts are blurry or unreadable.
 *
 * DB CONTEXT:
 *   - Loads video metadata, OCR, visual frames, and quality frames by
 *     request_id (`quality_frames` was previously missing from the loader —
 *     now included).
 *   - Uses frame-level `action`/`framing_composition` (replaces the old
 *     `visual_description`) and `technical_flags`, whose 4 values
 *     (`ai_artifacts`, `poor_framing_lighting`, `jarring_transitions`,
 *     `illegible_text`) map directly onto this agent's relevant sub-checks
 *     (minus anything about video corruption/dropped frames, which comes
 *     from `video_metadata` instead).
 *   - `quality_frames` gives deterministic evidence (`sharpness`,
 *     `crushed_frac`/`blown_frac`, `contrast`, `grain`, `blockiness`,
 *     `temporal_delta`, `reasons`) for the CV-detectable side of production
 *     quality — distinct from and complementary to the VLM-judged
 *     `technical_flags`.
 *   - `camera_movement` no longer exists on `visual_frames` — a single still
 *     frame can't reliably show motion; replaced by video-level `dynamism`
 *     on `video_metadata` if a coarse motion signal is needed.
 *
 * OUTPUT JSON STRUCTURE:
 *   [
 *     {
 *       "metric_id": "production_readiness",
 *       "agent": "visual_quality",
 *       "metric_name": "Production / Asset Readiness",
 *       "question": "Is the video technically complete enough to be reviewed or launched?",
 *       "result": "false",
 *       "severity": "high",
 *       "confidence": "high",
 *       "evidence": [
 *         {
 *           "type": "visual",
 *           "text": "Flicker artifacting and morphing frames detected around transition.",
 *           "timestamp": "00:07"
 *         }
 *       ],
 *       "explanation": "Severe AI visual morphing/flickering artifacts on transition between scene 1 and scene 2.",
 *       "suggested_correction": "Re-generate transition frames or replace with clean cut.",
 *       "correction_type": "edit_recommendation",
 *       "sub_checks": [
 *         {
 *           "check_id": "video_corruption",
 *           "name": "File Integrity",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "dropped_frames",
 *           "name": "Frame Sync Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "ai_artifacts",
 *           "name": "AI Artifacts Audit",
 *           "result": "failed",
 *           "severity": "high",
 *           "explanation": "Distorted patterns and flickering backgrounds are clearly visible at 7000ms."
 *         },
 *         {
 *           "check_id": "poor_framing_lighting",
 *           "name": "Framing and Lighting Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "jarring_transitions",
 *           "name": "Transition Continuity Check",
 *           "result": "passed",
 *           "severity": "none"
 *         },
 *         {
 *           "check_id": "illegible_text",
 *           "name": "Text Quality Check",
 *           "result": "passed",
 *           "severity": "none"
 *         }
 *       ]
 *     }
 *   ]
 *
 * CORE EVALUATIONS & SEVERITIES:
 *
 *   1. Production / Asset Readiness (production_readiness)
 *      - None (0): Lighting is balanced, video resolution is sharp, and editing cuts are professional.
 *      - Low (1): Minor production flaw (e.g. minor lighting overexposure).
 *      - Medium (2): Pacing transition errors, minor visual clipping.
 *      - High (3): Major technical flaws (e.g. missing transitions, extreme pixelation, severe AI artifact distortions).
 *      - Critical (4): The video file is severely corrupted, technically incomplete, or terminates abruptly.
 *
 * PIPELINE STAGES (No code implemented yet):
 *   Stage 1: Metadata check - Inspect resolution and dropped-frame markers.
 *   Stage 2: OCR check - Use timing and optional text-size/region data as legibility candidates.
 *   Stage 3: Visual check — analyse scene descriptions, lighting, camera movement, and technical flags for artifacts, framing, and cut quality.
 *   Stage 4: Synthesis & Scoring - Map findings to production_readiness result.
 */

import { createEdgeHandler, err, ok } from "../shared/index.ts";
import { AgentRunRequestSchema } from "../shared/schemas.ts";

import { runVisualQualityAgent } from "./agent.ts";

createEdgeHandler(
  "visual-quality-agent",
  AgentRunRequestSchema,
  async (_req, ctx) => {
    try {
      return ok([
        await runVisualQualityAgent(ctx.body, {
          userId: ctx.user.id,
        }),
      ]);
    } catch (error) {
      console.error("VISUAL_QUALITY_FAILED:", error);

      return err(
        "VISUAL_QUALITY_FAILED",
        error instanceof Error
          ? error.message
          : "Unexpected visual quality failure",
        500,
      );
    }
  },
);
