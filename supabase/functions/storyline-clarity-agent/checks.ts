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
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
  VideoMetadata,
} from "../shared/schemas.ts";
import {
  cannotAssess,
  failed,
  passed,
  severityRank,
} from "../shared/checks.ts";
import type { PlatformSpec } from "./config.ts";

// ── Severity ordering ───────────────────────────────────────────────────────
// `severityRank` comes from shared/checks.ts (Anusha's kit): `cannot_assess`
// ranks at -1 — deliberately outside the none→critical ordering, since it is a
// result state, not a risk level. `clampSeverity` below builds on it.

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

// ── SubCheckResult builders (shared) + config gate ───────────────────────────

// passed/failed/cannotAssess are the shared constructors from shared/checks.ts
// (Anusha's kit). Re-exported so this agent's other modules keep importing them
// from one local place.
export { cannotAssess, failed, passed };

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

/**
 * Reconcile a metric's correction_type against its rolled-up result. A metric
 * that passed ("true") or could not be assessed ("cannot_assess") has nothing to
 * correct, so its correction_type is forced to "none" and any suggested_correction
 * is dropped. Only a genuine failure ("false") keeps a correction — its stated
 * correction_type (a missing one defaulting to "edit_recommendation") and its
 * suggested_correction. This is the single choke point that stops a clean pass
 * from carrying an "edit_recommendation" the model left unset. Kept local to the
 * agent folder like the other metric-assembly helpers.
 */
export function reconcileMetricCorrection(
  result: "true" | "false" | "cannot_assess",
  fields: {
    correction_type?: MetricResult["correction_type"];
    suggested_correction?: string;
  },
): {
  correction_type: NonNullable<MetricResult["correction_type"]>;
  suggested_correction?: string;
} {
  if (result !== "false") {
    return { correction_type: "none", suggested_correction: undefined };
  }
  return {
    correction_type: fields.correction_type ?? "edit_recommendation",
    suggested_correction: fields.suggested_correction,
  };
}

/**
 * Derive a metric-level explanation + evidence from a metric's failed sub-checks,
 * for when the LLM returned verdicts but left the metric-level narrative blank.
 * This is reuse of judgments the model already made (each failed sub-check carries
 * its own explanation), not invented content — so a failing metric is never
 * persisted with no metric-level evidence (agent_result_evidence is populated only
 * from metric.evidence). Returns undefined when nothing failed (a pass needs no
 * derived narrative). Kept local like the other metric-assembly helpers.
 */
export function narrativeFromFailedChecks(
  subChecks: SubCheckResult[],
): { explanation: string; evidence: EvidenceRef[] } | undefined {
  const failures = subChecks.filter((c) => c.result === "failed");
  if (failures.length === 0) return undefined;
  const explanation = failures
    .map((c) => (c.explanation ? `${c.name}: ${c.explanation}` : c.name))
    .join(" ");
  const evidence: EvidenceRef[] = failures
    .filter((c) => c.explanation)
    .map((c) => ({
      type: "metadata",
      text: `${c.name}: ${c.explanation}`,
      timestamp: "",
    }));
  return { explanation, evidence };
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
