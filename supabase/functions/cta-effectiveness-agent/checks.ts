/**
 * checks.ts — CTA deterministic sub-checks (no model call) + goal-conditional
 * severity table for cta_absent.
 *
 * Pure functions of (inputs, config). CTAs come from Call 1 acquisition (derived
 * from transcript/OCR), each carrying numeric start_ms/end_ms, so the positional
 * checks (cta_buried, cta_mistimed) are deterministic arithmetic over those
 * timestamps. cta_low_visibility is SIZE-only (region_size + font_size_px) —
 * contrast_ratio is not in the AgentContext and these agents never inspect
 * pixels. Each config-dependent check gates to cannot_assess until its
 * threshold/table is populated.
 */

import type {
  OCRSegment,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";
import {
  cannotAssess,
  failed,
  gateOnConfig,
  passed,
} from "../shared/subcheck.ts";
import { maxSeverity } from "../shared/severity.ts";
import type {
  CtaTiming,
  CtaVisibilityThresholds,
  PlatformPhrasing,
} from "../shared/config/index.ts";
import type { AcquiredCta } from "./response_schemas.ts";

const BURIED = { id: "cta_buried", name: "CTA Position Check" };
const MISTIMED = { id: "cta_mistimed", name: "CTA Timing Check" };
const LOW_VIS = { id: "cta_low_visibility", name: "CTA Visibility Check" };
const PLATFORM = {
  id: "cta_platform_mismatch",
  name: "CTA Platform Alignment",
};

/** cta_absent severity is goal-conditional (same absence, different business risk). */
export const CTA_ABSENT_SEVERITY: Record<string, SeverityLevel> = {
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

      const matched = ocrSegments.filter(
        (o) =>
          o.region_size !== undefined &&
          o.font_size_px !== undefined &&
          onScreen.some((c) => overlaps(c, o)),
      );
      if (matched.length === 0) {
        return cannotAssess(
          LOW_VIS.id,
          LOW_VIS.name,
          "On-screen CTA present but region-size/font-size were not provided.",
        );
      }

      let worst: SeverityLevel = "none";
      for (const o of matched) {
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
      return worst === "none" ? passed(LOW_VIS.id, LOW_VIS.name) : failed(
        LOW_VIS.id,
        LOW_VIS.name,
        worst,
        "CTA text is too small to register legibly.",
      );
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
