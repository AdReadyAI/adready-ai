/** Shared constructors and roll-up rules for agent sub-checks. */
import type { EvidenceRef, SeverityLevel, SubCheckResult } from "./schemas.ts";

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  // This is an unassessed state, not a "no issue" result.
  cannot_assess: -1,
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Returns the shared ordering for severity comparisons.
 *
 * Keep the rank map private so agents depend on this stable operation rather
 * than the representation used to implement it.
 */
export function severityRank(severity: SeverityLevel): number {
  return SEVERITY_RANK[severity];
}

export function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${
    String(seconds % 60).padStart(2, "0")
  }`;
}

export function timestampFromMs(
  startMs?: number | string,
  endMs?: number,
): string {
  if (startMs === undefined || startMs === "") return "";

  if (typeof startMs === "string") {
    if (startMs.includes("-")) {
      const parts = startMs.split("-");
      if (parts.length === 2) {
        const sNum = Number(parts[0].trim());
        const eNum = Number(parts[1].trim());
        if (!isNaN(sNum) && !isNaN(eNum)) {
          return `${formatMs(sNum)} - ${formatMs(eNum)}`;
        }
      }
    }
    const num = Number(startMs);
    if (!isNaN(num)) {
      return timestampFromMs(num, endMs);
    }
    return startMs;
  }

  const startFormatted = formatMs(startMs);
  if (endMs !== undefined && endMs !== startMs) {
    const endFormatted = formatMs(endMs);
    return `${startFormatted} - ${endFormatted}`;
  }

  return startFormatted;
}

export function evidence(
  type: EvidenceRef["type"],
  text: string,
  timestampMs?: number | string,
  endTimestampMs?: number,
): EvidenceRef {
  return {
    type,
    text,
    timestamp: timestampFromMs(timestampMs, endTimestampMs),
  };
}

export function passed(checkId: string, name: string): SubCheckResult {
  return { check_id: checkId, name, result: "passed", severity: "none" };
}

export function failed(
  checkId: string,
  name: string,
  severity: Exclude<SeverityLevel, "none" | "cannot_assess">,
  explanation?: string,
): SubCheckResult {
  return { check_id: checkId, name, result: "failed", severity, explanation };
}

export function cannotAssess(
  checkId: string,
  name: string,
  explanation?: string,
): SubCheckResult {
  return {
    check_id: checkId,
    name,
    result: "cannot_assess",
    severity: "cannot_assess",
    explanation,
  };
}

export function highestFailedSeverity(
  checks: SubCheckResult[],
): SeverityLevel {
  return checks
    .filter((check) => check.result === "failed")
    .reduce<SeverityLevel>(
      (highest, check) =>
        severityRank(check.severity) > severityRank(highest)
          ? check.severity
          : highest,
      "none",
    );
}

export function rollupChecks(checks: SubCheckResult[]): {
  result: "true" | "false" | "cannot_assess";
  severity: SeverityLevel;
} {
  const assessable = checks.filter((check) => check.result !== "cannot_assess");
  if (assessable.length === 0) {
    return { result: "cannot_assess", severity: "cannot_assess" };
  }

  const severity = highestFailedSeverity(checks);
  return severity === "none"
    ? { result: "true", severity: "none" }
    : { result: "false", severity };
}
