/**
 * visual-quality-agent/utils.ts — Shared Visual Quality Agent utilities.
 *
 * Provides small deterministic helpers used across the agent pipeline,
 * including:
 * - severity score to severity label conversion,
 * - millisecond to MM:SS timestamp conversion,
 * - worst-severity calculation,
 * - confidence score bucketing,
 * - and evidence reference construction.
 */

import type {
  ConfidenceLevel,
  EvidenceRef,
  SeverityLevel,
} from "../shared/schemas.ts";

import type { SeverityScore } from "./types.ts";

export function severityFromScore(
  score: SeverityScore,
): SeverityLevel {
  const table: Record<SeverityScore, SeverityLevel> = {
    0: "none",
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
  };

  return table[score];
}

export function msToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
}

export function worstSeverity(
  scores: SeverityScore[],
): SeverityScore {
  if (scores.length === 0) {
    return 0;
  }

  return Math.max(...scores) as SeverityScore;
}

export function confidenceBucket(
  score: number,
): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";

  return "low";
}

export function evidenceFromTimestamp(
  type: EvidenceRef["type"],
  text: string,
  timestampMs: number | null,
): EvidenceRef {
  return {
    type,
    text,
    timestamp: timestampMs === null ? "" : msToTimestamp(timestampMs),
  };
}
