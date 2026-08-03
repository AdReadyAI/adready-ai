import type {
  AgentContext,
  ConfidenceLevel,
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/index.ts";
import {
  cannotAssess,
  evidence,
  failed,
  passed,
  rollupChecks,
  timestampFromMs,
} from "../shared/index.ts";

export type CheckAssessment = {
  checks: SubCheckResult[];
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
};

export function formatTimestamp(milliseconds?: number): string {
  return timestampFromMs(milliseconds);
}

export function toEvidence(
  type: EvidenceRef["type"],
  text: string,
  timestamp_ms?: number,
): EvidenceRef {
  return evidence(type, text, timestamp_ms);
}

export function makeCheck(
  check_id: string,
  name: string,
  result: SubCheckResult["result"],
  severity: SeverityLevel,
  explanation?: string,
): SubCheckResult {
  if (result === "passed") return passed(check_id, name);
  if (result === "cannot_assess") {
    return cannotAssess(check_id, name, explanation);
  }

  const failureSeverity = severity === "none" || severity === "cannot_assess"
    ? "medium"
    : severity;
  return failed(check_id, name, failureSeverity, explanation);
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
  const logoEvidence = detected.map((frame) =>
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
    evidence: logoEvidence,
    confidence: absent ? "medium" : "high",
  };
}

/** Aggregates individual checks into the shared Brand Fit result. */
export function buildBrandResult(
  logo: CheckAssessment,
  qualitative: CheckAssessment,
): MetricResult {
  const sub_checks = [...logo.checks, ...qualitative.checks];
  const failedChecks = sub_checks.filter((item) => item.result === "failed");
  const unavailable = sub_checks.filter((item) =>
    item.result === "cannot_assess"
  );
  const { result, severity } = rollupChecks(sub_checks);
  const failedIds = new Set(failedChecks.map((item) => item.check_id));
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
    question:
      "Does the ad's logo, visual identity, and voice align with the supplied brand guidance?",
    result,
    severity,
    confidence: logo.confidence === "low" || qualitative.confidence === "low"
      ? "low"
      : logo.confidence === "medium" || qualitative.confidence === "medium"
      ? "medium"
      : "high",
    evidence: [...logo.evidence, ...qualitative.evidence],
    explanation: result === "cannot_assess"
      ? "Brand fit could not be fully assessed because required brand guidance or qualitative evaluation was unavailable."
      : result === "true"
      ? unavailable.length > 0
        ? "The available brand evidence aligns with the supplied guidance, but some checks could not be assessed."
        : "The available logo, palette, and voice evidence aligns with the supplied brand guidance."
      : failedChecks.map((item) => item.explanation).filter(Boolean).join(" "),
    suggested_correction,
    correction_type: suggested_correction
      ? failedIds.has("brand_voice_drift") && failedIds.size === 1
        ? "rewrite"
        : "edit_recommendation"
      : "none",
    sub_checks,
  };
}
