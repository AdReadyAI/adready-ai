/**
 * utils.ts — Small shared helpers with no dependency on mock vs real
 * implementations.
 */

import type { ConfidenceLevel, SeverityLevel } from "../shared/schemas.ts";
import type { ClaimCategory, SeverityScore, TriageResult } from "./types.ts";

/** Formats a millisecond offset as an MM:SS timestamp string. */
export function msToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
}

/** Maps the design doc's 0-4 severity score onto the shared SeverityLevel enum. */
export function mapSeverityScore(score: SeverityScore): SeverityLevel {
  const table: Record<SeverityScore, SeverityLevel> = {
    0: "none",
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
  };
  return table[score];
}

/** Highest (worst) severity in a list of scores; 0 ("none") if the list is empty. */
export function worstSeverityScore(scores: SeverityScore[]): SeverityScore {
  return scores.length ? (Math.max(...scores) as SeverityScore) : 0;
}

/** Buckets a continuous 0.0-1.0 confidence score onto the shared ConfidenceLevel enum. */
export function bucketConfidence(score: number): ConfidenceLevel {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/**
 * Unique verifiable-claim categories present in a triage pass, in stable
 * order. This is the retrieval fan-out list: one retrieval call per entry,
 * not one per claim.
 */
export function uniqueCategories(triage: TriageResult[]): ClaimCategory[] {
  const seen = new Set<ClaimCategory>();
  for (const t of triage) {
    if (t.is_verifiable_claim && t.category) seen.add(t.category);
  }
  return [...seen];
}

/** Shortens claim text for use as a sub_check name/label. */
export function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
