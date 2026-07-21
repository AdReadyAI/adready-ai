import type {
  AgentContext,
  ConfidenceLevel,
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";

export type CheckAssessment = {
  checks: SubCheckResult[];
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
};

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  none: 0,
  cannot_assess: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function formatTimestamp(milliseconds?: number): string {
  if (milliseconds === undefined) return "";
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${
    String(seconds % 60).padStart(2, "0")
  }`;
}

export function toEvidence(
  type: EvidenceRef["type"],
  text: string,
  timestamp_ms?: number,
): EvidenceRef {
  return { type, text, timestamp: formatTimestamp(timestamp_ms) };
}

export function makeCheck(
  check_id: string,
  name: string,
  result: SubCheckResult["result"],
  severity: SeverityLevel,
  explanation?: string,
): SubCheckResult {
  return { check_id, name, result, severity, explanation };
}

/** Deterministic logo presence and reference-match checks. */
export function evaluateLogoChecks(context: AgentContext): CheckAssessment {
  const guidelines = context.parsed_creative_brief.brand_guidelines;
  const logoIsRequired =
    guidelines.some((guideline) => /logo|brand mark/i.test(guideline)) ||
    context.product_context?.reference_asset_urls.some((url) =>
        /logo/i.test(url)
      ) === true;

  if (!logoIsRequired) {
    return {
      checks: [
        makeCheck(
          "logo_absent",
          "Logo Presence Check",
          "cannot_assess",
          "cannot_assess",
          "No logo requirement or reference asset was supplied.",
        ),
        makeCheck(
          "logo_incorrect",
          "Logo Accuracy Check",
          "cannot_assess",
          "cannot_assess",
          "No logo requirement or reference asset was supplied.",
        ),
      ],
      evidence: [],
      confidence: "low",
    };
  }

  const detected = context.logo_frames.filter((frame) =>
    frame.prominence !== "absent" && frame.confidence_score >= 0.5
  );
  const evidence = detected.map((frame) =>
    toEvidence(
      "visual",
      `Logo detection ${
        frame.reference_match ?? "without reference comparison"
      }; prominence: ${frame.prominence ?? "unknown"}.`,
      frame.timestamp_ms,
    )
  );
  const absent = detected.length === 0;
  const incorrect = detected.some((frame) =>
    frame.reference_match === "differs_from_reference"
  );

  return {
    checks: [
      makeCheck(
        "logo_absent",
        "Logo Presence Check",
        absent ? "failed" : "passed",
        absent ? "high" : "none",
        absent
          ? "A logo is required by the brief or reference assets, but no reliable logo detection was found."
          : undefined,
      ),
      makeCheck(
        "logo_incorrect",
        "Logo Accuracy Check",
        absent ? "cannot_assess" : incorrect ? "failed" : "passed",
        absent ? "cannot_assess" : incorrect ? "medium" : "none",
        incorrect
          ? "At least one detected logo differs from the approved reference."
          : undefined,
      ),
    ],
    evidence,
    confidence: absent ? "medium" : "high",
  };
}

/** Aggregates individual checks into the shared Brand Fit result. */
export function buildBrandResult(
  logo: CheckAssessment,
  qualitative: CheckAssessment,
): MetricResult {
  const sub_checks = [...logo.checks, ...qualitative.checks];
  const failed = sub_checks.filter((item) => item.result === "failed");
  const assessable = sub_checks.filter((item) =>
    item.result !== "cannot_assess"
  );
  const severity = failed.reduce<SeverityLevel>(
    (current, item) =>
      SEVERITY_RANK[item.severity] > SEVERITY_RANK[current]
        ? item.severity
        : current,
    "none",
  );
  const result = assessable.length === 0
    ? "cannot_assess"
    : failed.length > 0
    ? "false"
    : "true";
  const failedIds = new Set(failed.map((item) => item.check_id));
  const suggested_correction = failedIds.has("logo_absent")
    ? "Add the approved logo in the placement required by the brand guidelines."
    : failedIds.has("logo_incorrect")
    ? "Replace the detected logo with the approved reference asset."
    : failedIds.has("color_palette_off")
    ? "Update colors and typography to match the supplied brand guidelines."
    : failedIds.has("brand_voice_drift")
    ? "Rewrite the voiceover and on-screen copy to match the supplied brand voice."
    : undefined;

  return {
    metric_id: "brand_fit",
    agent: "brand_alignment",
    metric_name: "Brand Fit",
    result,
    severity: result === "cannot_assess" ? "cannot_assess" : severity,
    confidence: logo.confidence === "low" || qualitative.confidence === "low"
      ? "low"
      : logo.confidence === "medium" || qualitative.confidence === "medium"
      ? "medium"
      : "high",
    evidence: [...logo.evidence, ...qualitative.evidence].slice(0, 6),
    explanation: result === "cannot_assess"
      ? "Brand fit could not be fully assessed because required brand guidance or qualitative evaluation was unavailable."
      : result === "true"
      ? "The available logo, palette, and voice evidence aligns with the supplied brand guidance."
      : failed.map((item) => item.explanation).filter(Boolean).join(" "),
    suggested_correction,
    correction_type: suggested_correction
      ? failedIds.has("brand_voice_drift") && failedIds.size === 1
        ? "rewrite"
        : "edit_recommendation"
      : "none",
    sub_checks,
  };
}
