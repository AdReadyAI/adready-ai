/**
 * visual-quality-agent/types.ts — Internal Visual Quality Agent types.
 *
 * Defines the internal contracts used between the agent's evaluation stages.
 *
 * These types distinguish between:
 * - deterministic metadata/OCR checks,
 * - LLM-assisted visual findings,
 * - the six production-readiness sub-checks,
 * - and the final MetricResult synthesis.
 *
 * These are internal agent types and are intentionally separate from
 * the shared public schemas used by the Edge Function API.
 */

import type { AgentContext, EvidenceRef } from "../shared/schemas.ts";

export type SeverityScore = 0 | 1 | 2 | 3 | 4;

export type VisualCheckId =
  | "ai_artifacts"
  | "poor_framing_lighting"
  | "jarring_transitions";

export type DeterministicCheckId =
  | "video_corruption"
  | "dropped_frames"
  | "illegible_text";

export type CheckId =
  | VisualCheckId
  | DeterministicCheckId;

export type InternalCheckResult = {
  check_id: CheckId;
  name: string;
  result: "passed" | "failed" | "cannot_assess";
  severityScore: SeverityScore;
  explanation?: string;
  evidence?: EvidenceRef;
  confidence_score: number;
};

export type ProductionReadinessChecks = {
  video_corruption: InternalCheckResult;
  dropped_frames: InternalCheckResult;
  ai_artifacts: InternalCheckResult;
  poor_framing_lighting: InternalCheckResult;
  jarring_transitions: InternalCheckResult;
  illegible_text: InternalCheckResult;
};

export type VisualAuditFinding = {
  check_id: VisualCheckId;
  severity: SeverityScore;
  explanation: string;
  evidence_text: string;
  evidence_timestamp_ms: number | null;
  confidence_score: number;
};

export type VisualAuditLLMResponse = {
  findings: Array<{
    check_id: VisualCheckId;
    severity: SeverityScore;
    explanation: string;
    evidence_text: string;
    evidence_timestamp_ms: number | null;
    confidence_score: number;
  }>;
};

export type VisualQualityContextProvider = (
  requestId: string,
) => Promise<AgentContext>;

export type VisualQualityAuditor = (
  context: AgentContext,
) => Promise<VisualAuditFinding[]>;

export type ProductionReadinessEvaluator = (
  context: AgentContext,
  checks: ProductionReadinessChecks,
) => import("../shared/schemas.ts").MetricResult;
