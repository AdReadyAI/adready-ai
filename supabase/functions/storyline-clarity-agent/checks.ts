/**
 * checks.ts — Storyline sub-check helpers + deterministic sub-checks (no model call).
 *
 * The top of this file holds the small, self-contained helpers this agent uses
 * to build and grade sub-checks: the severity ordering, the SubCheckResult
 * builders, and `gateOnConfig`. They are kept here (rather than in a shared
 * framework) so the agent folder is self-contained like the other agents.
 *
 * channel_readiness's deterministic sub-check is format_noncompliant; its
 * placement/audience-fit sub-check (placement_mismatch) is LLM-judged in agent.ts.
 * pacing_misallocation is likewise not deterministic: the AgentContext exposes
 * point-in-time visual_frames (no scene durations to sum), so pacing is judged
 * by the LLM in Call 2. format_noncompliant is a pure function of
 * (metadata, spec); it gates on the platform spec table via `gateOnConfig`.
 */

import type {
  SeverityLevel,
  SubCheckResult,
  VideoMetadata,
} from "../shared/schemas.ts";
import type { PlatformSpec } from "./config.ts";

// ── Severity ordering ───────────────────────────────────────────────────────
// `cannot_assess` is deliberately outside this ordering: it is a result state,
// not a risk level. Helpers treat any out-of-range value (including
// cannot_assess) as ranking below "none".

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

// ── SubCheckResult builders + config gate ────────────────────────────────────

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

// ── Deterministic sub-checks ─────────────────────────────────────────────────

const FORMAT = { id: "format_noncompliant", name: "Format Compliance" };

/** Parse "1920x1080" → [1920, 1080]; null when unparseable. */
function parseResolution(resolution: string): [number, number] | null {
  const m = resolution.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * format_noncompliant — aspect ratio / resolution / duration vs the platform's
 * spec row. Severity: critical (corrupt / fails ingestion) → high (wrong
 * dimensions or aspect) → medium (over the hard duration limit) → low (minor
 * duration tolerance breach) → none (all match). cannot_assess until the spec
 * table is populated.
 */
export function formatNoncompliant(
  metadata: VideoMetadata,
  spec: PlatformSpec | null,
): SubCheckResult {
  return gateOnConfig(
    spec,
    FORMAT.id,
    FORMAT.name,
    "platform technical-spec table not yet populated",
    (spec) => {
      if (metadata.corruption_detected === true) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "critical",
          "Asset is corrupted or fails platform ingestion.",
        );
      }

      const aspectOk = spec.allowed_aspect_ratios.includes(
        metadata.aspect_ratio,
      );
      const dims = parseResolution(metadata.resolution);
      const resOk = dims === null ||
        (dims[0] >= spec.min_width && dims[1] >= spec.min_height);
      if (!aspectOk || !resOk) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "high",
          `Aspect ratio/dimensions (${metadata.aspect_ratio}, ${metadata.resolution}) are wrong for the placement.`,
        );
      }

      if (metadata.duration_ms > spec.max_duration_ms) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "medium",
          `Duration ${metadata.duration_ms}ms exceeds the platform maximum.`,
        );
      }
      if (metadata.duration_ms > spec.optimal_max_duration_ms) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "low",
          `Duration ${metadata.duration_ms}ms is slightly over the optimal limit.`,
        );
      }
      return passed(FORMAT.id, FORMAT.name);
    },
  );
}
