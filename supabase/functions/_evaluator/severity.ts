/**
 * severity.ts — Ordering helpers for the five business-risk severities.
 *
 * `cannot_assess` is deliberately outside this ordering: it is a result state,
 * not a risk level. Helpers here operate on the ranked five and treat any
 * out-of-range value (including `cannot_assess`) as ranking below "none".
 */

import type { SeverityLevel } from "../shared/schemas.ts";

/** Worst-wins ordering, low index = lower business risk. */
export const SEVERITY_ORDER: readonly SeverityLevel[] = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
];

export function severityRank(severity: SeverityLevel): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** The higher-risk of two severities (worst-wins). */
export function maxSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return severityRank(b) > severityRank(a) ? b : a;
}

/**
 * Clamp a severity down to a maximum allowed for a given check. Used to validate
 * an LLM-returned severity against the range its sub-check is allowed to carry
 * (e.g. value_prop_unclear may not exceed "medium"). Values at or below `max`,
 * and any non-ranked value, are returned unchanged.
 */
export function clampSeverity(
  severity: SeverityLevel,
  max: SeverityLevel,
): SeverityLevel {
  if (severityRank(severity) < 0) return severity; // e.g. cannot_assess: leave as-is
  return severityRank(severity) > severityRank(max) ? max : severity;
}
