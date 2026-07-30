/**
 * checks.ts — CTA sub-check helpers + deterministic sub-checks (no model call) +
 * the goal-conditional severity table for cta_absent.
 *
 * The top of this file holds the small, self-contained helpers this agent uses
 * to build and grade sub-checks: the severity ordering, the SubCheckResult
 * builders, and `gateOnConfig`. They are kept here (rather than in a shared
 * framework) so the agent folder is self-contained like the other agents.
 *
 * The deterministic checks are pure functions of (inputs, config). CTAs come
 * from Call 1 acquisition (derived from transcript/OCR), each carrying numeric
 * start_ms/end_ms, so the positional checks (cta_buried, cta_mistimed) are
 * deterministic arithmetic over those timestamps. cta_low_visibility is
 * SIZE-only (region_size + font_size_px) — contrast_ratio is not in the
 * AgentContext and these agents never inspect pixels. Each config-dependent
 * check gates to cannot_assess until its threshold/table is populated.
 */

import type {
  EvidenceRef,
  MetricResult,
  OCRSegment,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";
import {
  cannotAssess,
  failed,
  passed,
  severityRank,
} from "../shared/checks.ts";
import type {
  CtaTiming,
  CtaVisibilityThresholds,
  PlatformPhrasing,
} from "./config.ts";
import type { AcquiredCta } from "./response_schemas.ts";

// ── Severity ordering ───────────────────────────────────────────────────────
// `severityRank` comes from shared/checks.ts (Anusha's kit): `cannot_assess`
// ranks at -1 — deliberately outside the none→critical ordering, since it is a
// result state, not a risk level. The helpers below build on it.

/** The higher-risk of two severities (worst-wins). */
export function maxSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return severityRank(b) > severityRank(a) ? b : a;
}

/**
 * Clamp a severity down to a maximum allowed for a given check. Used to validate
 * an LLM-returned severity against the range its sub-check is allowed to carry.
 * Values at or below `max`, and any non-ranked value, are returned unchanged.
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

const BURIED = { id: "cta_buried", name: "CTA Position Check" };
const MISTIMED = { id: "cta_mistimed", name: "CTA Timing Check" };
const LOW_VIS = { id: "cta_low_visibility", name: "CTA Visibility Check" };
const PLATFORM = {
  id: "cta_platform_mismatch",
  name: "CTA Platform Alignment",
};

/** cta_absent severity is goal-conditional (same absence, different business risk). */
export const CTA_ABSENT_SEVERITY: Record<
  string,
  "none" | "medium" | "high" | "critical"
> = {
  awareness: "none",
  consideration: "medium",
  repurchase: "high",
  conversion: "critical",
};

/**
 * cta_buried — a CTA that appears only inside the opening window and is never
 * repeated at the close. failed/high when every occurrence starts within
 * buried_window_ms, else none. Empty list → passed (absence is cta_absent's job).
 * cannot_assess when timing config is unset.
 */
export function ctaBuried(
  ctas: readonly AcquiredCta[],
  timing: CtaTiming | null,
): SubCheckResult {
  return gateOnConfig(
    timing,
    BURIED.id,
    BURIED.name,
    "CTA timing benchmarks not yet populated",
    (timing) => {
      if (ctas.length === 0) return passed(BURIED.id, BURIED.name);
      const allEarly = ctas.every((c) => c.start_ms <= timing.buried_window_ms);
      return allEarly
        ? failed(
          BURIED.id,
          BURIED.name,
          "high",
          "The CTA appears only in the opening seconds and is never repeated at the close.",
        )
        : passed(BURIED.id, BURIED.name);
    },
  );
}

/**
 * cta_mistimed — positional. none when at least one occurrence lands in the
 * configured landing zone AND dwells long enough; low when it lands late but too
 * briefly; medium otherwise. Empty list → passed. cannot_assess when timing
 * config is unset or duration is unknown.
 */
export function ctaMistimed(
  ctas: readonly AcquiredCta[],
  durationMs: number,
  timing: CtaTiming | null,
): SubCheckResult {
  return gateOnConfig(
    timing,
    MISTIMED.id,
    MISTIMED.name,
    "CTA timing benchmarks not yet populated",
    (timing) => {
      if (durationMs <= 0) {
        return cannotAssess(
          MISTIMED.id,
          MISTIMED.name,
          "Total duration is unknown; cannot compute CTA position.",
        );
      }
      if (ctas.length === 0) return passed(MISTIMED.id, MISTIMED.name);

      const inZone = (c: AcquiredCta) => {
        const fraction = c.start_ms / durationMs;
        return fraction >= timing.landing_zone_start_fraction &&
          fraction <= timing.landing_zone_end_fraction;
      };
      const dwellOk = (c: AcquiredCta) =>
        c.end_ms - c.start_ms >= timing.min_dwell_ms;

      if (ctas.some((c) => inZone(c) && dwellOk(c))) {
        return passed(
          MISTIMED.id,
          MISTIMED.name,
        );
      }
      if (ctas.some((c) => inZone(c))) {
        return failed(
          MISTIMED.id,
          MISTIMED.name,
          "low",
          "The CTA lands late enough but dwells too briefly to register.",
        );
      }
      return failed(
        MISTIMED.id,
        MISTIMED.name,
        "medium",
        "No CTA occurrence lands in the closing portion of the runtime.",
      );
    },
  );
}

function overlaps(cta: AcquiredCta, ocr: OCRSegment): boolean {
  return cta.start_ms <= ocr.end_ms && ocr.start_ms <= cta.end_ms;
}

/** Tokenize for CTA↔OCR text association: lowercase, split on non-alphanumerics. */
function textTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

/**
 * Whether an OCR segment renders (part of) the CTA rather than merely sharing its
 * time window. An on-screen CTA's text is derived from the OCR itself, so the
 * CTA's words cover its own rendering segments; a co-timed but unrelated overlay —
 * a legal disclaimer, a separate headline — shares few or none. True when a
 * majority of the OCR segment's tokens appear in the CTA's token set. Without this,
 * temporal overlap alone lets a tiny co-timed disclaimer drag the CTA's legibility
 * score down (worst-wins), even though the CTA itself is rendered at a legible size.
 */
function ocrRendersCta(cta: AcquiredCta, ocr: OCRSegment): boolean {
  const ocrTokens = textTokens(ocr.text);
  if (ocrTokens.length === 0) return false;
  const ctaTokens = new Set(textTokens(cta.text));
  const hits = ocrTokens.filter((t) => ctaTokens.has(t)).length;
  return hits / ocrTokens.length >= 0.5;
}

/**
 * cta_low_visibility — SIZE-only legibility. Reads region_size and font_size_px
 * from ocr_segments[] (contrast_ratio is not available, and the agent never
 * inspects pixels). medium when under-size, low when marginal, none when clear.
 * Audio-only CTAs have no visibility surface → passed. On-screen CTA with no size
 * numbers → cannot_assess. cannot_assess when thresholds are unset.
 */
export function ctaLowVisibility(
  ctas: readonly AcquiredCta[],
  ocrSegments: readonly OCRSegment[],
  thresholds: CtaVisibilityThresholds | null,
): SubCheckResult {
  return gateOnConfig(
    thresholds,
    LOW_VIS.id,
    LOW_VIS.name,
    "region/font-size thresholds not yet populated",
    (thresholds) => {
      const onScreen = ctas.filter((c) =>
        c.source === "on_screen" || c.source === "visual"
      );
      if (onScreen.length === 0) return passed(LOW_VIS.id, LOW_VIS.name);

      // Sized OCR sharing a CTA's time window. Temporal overlap alone is only the
      // candidate set — it also captures co-timed non-CTA overlays — so the CTA's
      // own rendering is then selected by text below.
      const temporal = ocrSegments.filter(
        (o) =>
          o.region_size !== undefined &&
          o.font_size_px !== undefined &&
          onScreen.some((c) => overlaps(c, o)),
      );
      if (temporal.length === 0) {
        return cannotAssess(
          LOW_VIS.id,
          LOW_VIS.name,
          "On-screen CTA present but region-size/font-size were not provided.",
        );
      }

      // Prefer the OCR segments that actually render the CTA text; a co-timed
      // overlay whose words are not part of the CTA (e.g. a legal disclaimer) must
      // not drag the score. Fall back to the temporal set when nothing matches by
      // text, so assessability is never lost.
      const rendered = temporal.filter((o) =>
        onScreen.some((c) => overlaps(c, o) && ocrRendersCta(c, o))
      );
      const measured = rendered.length > 0 ? rendered : temporal;

      let worst: SeverityLevel = "none";
      for (const o of measured) {
        const region = o.region_size!;
        const font = o.font_size_px!;
        if (
          region < thresholds.min_region_size ||
          font < thresholds.min_font_size_px
        ) {
          worst = maxSeverity(worst, "medium");
        } else if (
          region < thresholds.marginal_region_size ||
          font < thresholds.marginal_font_size_px
        ) {
          worst = maxSeverity(worst, "low");
        }
      }
      if (worst === "medium" || worst === "low") {
        return failed(
          LOW_VIS.id,
          LOW_VIS.name,
          worst,
          "CTA text is too small to register legibly.",
        );
      }
      return passed(LOW_VIS.id, LOW_VIS.name);
    },
  );
}

/**
 * cta_platform_mismatch — lookup. failed/medium when a CTA's phrasing matches a
 * discouraged phrase for the destination platform (e.g. "swipe up" on modern
 * TikTok), else none. cannot_assess until the convention table is populated.
 */
export function ctaPlatformMismatch(
  ctaTexts: readonly string[],
  phrasing: PlatformPhrasing | null,
): SubCheckResult {
  return gateOnConfig(
    phrasing,
    PLATFORM.id,
    PLATFORM.name,
    "platform CTA phrasing table not yet populated",
    (phrasing) => {
      if (ctaTexts.length === 0) return passed(PLATFORM.id, PLATFORM.name);
      for (const text of ctaTexts) {
        const lower = text.toLowerCase();
        const hit = phrasing.discouraged_phrases.find((p) =>
          lower.includes(p.toLowerCase())
        );
        if (hit !== undefined) {
          return failed(
            PLATFORM.id,
            PLATFORM.name,
            "medium",
            `CTA phrasing "${text}" is discouraged on this platform.`,
          );
        }
      }
      return passed(PLATFORM.id, PLATFORM.name);
    },
  );
}
