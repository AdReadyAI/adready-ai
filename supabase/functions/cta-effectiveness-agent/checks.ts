/**
 * checks.ts — Deterministic arithmetic sub-checks and goal-conditional severity rules
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

export { cannotAssess, failed, passed };

export function maxSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return severityRank(b) > severityRank(a) ? b : a;
}

export function clampSeverity(
  severity: SeverityLevel,
  max: SeverityLevel,
): SeverityLevel {
  if (severityRank(severity) < 0) return severity;
  return severityRank(severity) > severityRank(max) ? max : severity;
}

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

const BURIED = { id: "cta_buried", name: "CTA Position Check" };
const MISTIMED = { id: "cta_mistimed", name: "CTA Timing Check" };
const LOW_VIS = { id: "cta_low_visibility", name: "CTA Visibility Check" };
const PLATFORM = {
  id: "cta_platform_mismatch",
  name: "CTA Platform Alignment",
};

export const CTA_ABSENT_SEVERITY: Record<
  string,
  "none" | "medium" | "high" | "critical"
> = {
  awareness: "none",
  consideration: "medium",
  repurchase: "high",
  conversion: "critical",
};

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
        return passed(MISTIMED.id, MISTIMED.name);
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

function textTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

function ocrRendersCta(cta: AcquiredCta, ocr: OCRSegment): boolean {
  const ocrTokens = textTokens(ocr.text);
  if (ocrTokens.length === 0) return false;

  const ctaTokens = new Set(textTokens(cta.text));
  const hits = ocrTokens.filter((t) => ctaTokens.has(t)).length;
  return hits / ocrTokens.length >= 0.5;
}

export function matchesRequiredCta(
  ctaText: string,
  requiredCtas: readonly string[],
): boolean {
  const ctaTokens = new Set(textTokens(ctaText));
  return requiredCtas.some((req) => {
    const reqTokens = textTokens(req);
    if (reqTokens.length === 0) return false;
    const hits = reqTokens.filter((t) => ctaTokens.has(t)).length;
    return hits / reqTokens.length >= 0.6;
  });
}

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

      const rendered = temporal.filter((o) =>
        onScreen.some((c) => overlaps(c, o) && ocrRendersCta(c, o))
      );
      const measured = rendered.length > 0 ? rendered : temporal;

      let worst: SeverityLevel = "none";
      const offenders: OCRSegment[] = [];

      for (const o of measured) {
        const region = o.region_size!;
        const font = o.font_size_px!;

        if (
          region < thresholds.min_region_size ||
          font < thresholds.min_font_size_px
        ) {
          worst = maxSeverity(worst, "medium");
          offenders.push(o);
        } else if (
          region < thresholds.marginal_region_size ||
          font < thresholds.marginal_font_size_px
        ) {
          worst = maxSeverity(worst, "low");
          offenders.push(o);
        }
      }

      if (worst === "medium" || worst === "low") {
        const smallest = offenders.reduce((a, b) =>
          b.font_size_px! < a.font_size_px! ? b : a
        );
        const restOk = measured.length > offenders.length
          ? "; the rest of the CTA is adequately sized"
          : "";

        return failed(
          LOW_VIS.id,
          LOW_VIS.name,
          worst,
          `The CTA element "${smallest.text}" is below the legible-size ` +
            `threshold (${smallest.font_size_px}px, ` +
            `${Math.round(smallest.region_size! * 100)}% of frame)${restOk}.`,
        );
      }

      return passed(LOW_VIS.id, LOW_VIS.name);
    },
  );
}

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
