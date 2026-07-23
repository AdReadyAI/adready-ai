/**
 * subcheck.ts — Builders for SubCheckResult and the config gate.
 *
 * Every sub-check (deterministic or LLM-merged) resolves to a SubCheckResult.
 * These builders keep that shape consistent, and `gateOnConfig` encodes the
 * project rule that an unresolved dependency degrades to `cannot_assess` rather
 * than a silent guess: a deterministic check whose threshold/table has not been
 * populated yet returns `cannot_assess`, never a fabricated pass or fail.
 */

import type { SeverityLevel, SubCheckResult } from "./schemas.ts";

export function passed(checkId: string, name: string): SubCheckResult {
  return { check_id: checkId, name, result: "passed", severity: "none" };
}

export function failed(
  checkId: string,
  name: string,
  severity: SeverityLevel,
  explanation: string,
): SubCheckResult {
  return { check_id: checkId, name, result: "failed", severity, explanation };
}

export function cannotAssess(
  checkId: string,
  name: string,
  reason: string,
): SubCheckResult {
  return {
    check_id: checkId,
    name,
    result: "cannot_assess",
    severity: "cannot_assess",
    explanation: reason,
  };
}

/**
 * Run a deterministic check only when its config dependency is populated.
 * When `config` is null/undefined (the unresolved default), the check degrades
 * to `cannot_assess` with `missingReason`; otherwise `evaluate` runs with the
 * resolved config. This is the single choke point that guarantees "no silent
 * guess when a dependency the team does not own is still missing."
 */
export function gateOnConfig<T>(
  config: T | null | undefined,
  checkId: string,
  name: string,
  missingReason: string,
  evaluate: (config: T) => SubCheckResult,
): SubCheckResult {
  if (config === null || config === undefined) {
    return cannotAssess(checkId, name, missingReason);
  }
  return evaluate(config);
}
