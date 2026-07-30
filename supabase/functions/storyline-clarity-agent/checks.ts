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
  AgentContext,
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
import type { ArcExpectation, PlatformSpec } from "./config.ts";
// Type-only import (erased at runtime, so no cycle with response_schemas.ts,
// which imports the SubCheckResult builders from this file).
import type { ArcLabeling } from "./response_schemas.ts";

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

// ── Input-density (sparse-analysis) gate ─────────────────────────────────────
// The analysis (frames/transcript) can be too thin to judge the ad's visuals or
// its platform/visual fit. When it is, placement_mismatch must not turn that
// sparsity into a loud "static / no visuals" failure — the same reason
// creative_effectiveness abstains on the visual/arc sub-checks (see the
// INSUFFICIENT DATA rule in prompts.ts). This deterministic gate lets agent.ts
// cap placement severity so the two metrics stop disagreeing about sparse input.

/** Floor for a dense-enough frame set: at least one frame per this many ms. */
export const MIN_MS_PER_FRAME = 5000;

/**
 * Whether the analysis input is too sparse to trust for visual/placement judgment:
 * the arc could not be labeled or came back low-confidence, or the frame set is thin
 * relative to the runtime (fewer than one frame per MIN_MS_PER_FRAME). Mirrors the
 * signal the Call-2 prompt uses to gate the creative visual/arc sub-checks.
 */
export function isSparseAnalysis(
  ctx: AgentContext,
  arc: ArcLabeling | null,
): boolean {
  if (arc === null || arc.overall_confidence === "low") return true;
  const minFrames = Math.ceil(
    ctx.video_metadata.duration_ms / MIN_MS_PER_FRAME,
  );
  return ctx.visual_frames.length < minFrames;
}

// ── story_incomplete over-fail reconciliation (deterministic guardrail) ──────
// story_incomplete is LLM-judged reading the labeled arc, but its bar is fully
// mechanical: the required arc roles must be present and (when the bucket demands
// it) the payoff must resolve on-screen. On a generally-weak-but-structurally-
// complete ad, the model tends to over-fail this check by importing NON-required
// roles (problem/solution) or a general "narrative feels thin" judgment — which
// is narrative_gap's job, not story_incomplete's. This guardrail corrects only
// that false positive, deterministically, from Call-1's arc + the config bucket.

/**
 * Whether the labeled arc mechanically satisfies the duration-bucket expectation:
 * every required arc role is present among the labeled frames, and — when the
 * bucket expects the payoff to resolve on-screen — payoff_resolved_at is non-null
 * (Call 1 sets it to the resolving frame's timestamp, or null if the story never
 * resolves). Pure function of the arc + expectation; no model judgment. Returns
 * false on a null arc or null expectation (nothing to prove against).
 */
export function arcSatisfiesExpectation(
  arc: ArcLabeling | null,
  expectation: ArcExpectation | null,
): boolean {
  if (arc === null || expectation === null) return false;
  const rolesPresent = new Set<string>(arc.arc.map((frame) => frame.role));
  const allRequiredFilled = expectation.expected_roles.every((role) =>
    rolesPresent.has(role)
  );
  if (!allRequiredFilled) return false;
  return expectation.expect_payoff_resolved
    ? arc.payoff_resolved_at !== null
    : true;
}

/**
 * Correct an LLM story_incomplete FALSE POSITIVE against the deterministic arc
 * math. A model-returned "failed" is flipped to passed only when BOTH hold: the
 * analysis is not sparse (on sparse input the arc itself is untrustworthy and the
 * LLM correctly abstains — never manufacture a pass there) AND the arc provably
 * satisfies the expectation (arcSatisfiesExpectation). Any other verdict — a pass,
 * a cannot_assess, or a failure the arc does NOT refute — is returned unchanged;
 * the guardrail only ever downgrades a contradicted failure, never invents one.
 */
export function reconcileStoryIncomplete(
  story: SubCheckResult,
  arc: ArcLabeling | null,
  expectation: ArcExpectation | null,
  sparse: boolean,
): SubCheckResult {
  if (story.result !== "failed" || sparse) return story;
  if (!arcSatisfiesExpectation(arc, expectation)) return story;
  return {
    check_id: story.check_id,
    name: story.name,
    result: "passed",
    severity: "none",
    explanation:
      "Corrected to pass: the labeled arc fills every required role" +
      " and the payoff resolves on-screen, so the ad is structurally complete;" +
      " any residual narrative weakness is graded under narrative_gap.",
  };
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
