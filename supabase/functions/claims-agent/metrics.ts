/**
 * metrics.ts — Pure, deterministic post-processing: no DB access, no LLM
 * calls, no I/O. Aggregates LLM findings into the two fixed-checklist
 * MetricResults (product_truth: 3 sub_checks, policy_compliance: 4
 * sub_checks) matching the agent's documented output structure.
 */

import {
  cannotAssess,
  evidence,
  failed,
  highestFailedSeverity,
  passed,
  severityRank,
} from "../shared/index.ts";
import type {
  EvidenceRef,
  MetricResult,
  OCRSegment,
  SeverityLevel,
  SubCheckResult,
  TranscriptSegment,
} from "../shared/index.ts";
import type {
  DerivedClaim,
  SeverityScore,
  SubstantiationClassification,
  SubstantiationFinding,
  TriageResult,
} from "./checks.ts";
import type { AdWidePolicyAssessment } from "./policy.ts";

/* -------------------------------------------------------------------------- */
/* Local helpers                                                             */
/* -------------------------------------------------------------------------- */

function mapSeverityScore(score: SeverityScore): SeverityLevel {
  const table: Record<SeverityScore, SeverityLevel> = {
    0: "none",
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
  };
  return table[score];
}

function bucketConfidence(
  score: number,
): NonNullable<MetricResult["confidence"]> {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((e) => {
    const key = `${e.type}|${e.text}|${e.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function worstFailedSubCheck(
  subChecks: SubCheckResult[],
): SubCheckResult | null {
  return subChecks
    .filter((c) => c.result === "failed")
    .reduce<SubCheckResult | null>(
      (worst, c) =>
        !worst || severityRank(c.severity) > severityRank(worst.severity)
          ? c
          : worst,
      null,
    );
}

/* -------------------------------------------------------------------------- */
/* product_truth -- 3 fixed sub_checks, aggregated from per-claim findings   */
/* -------------------------------------------------------------------------- */

const PRODUCT_TRUTH_CHECKS: {
  classification: SubstantiationClassification;
  checkId: string;
  name: string;
}[] = [
  {
    classification: "unsupported",
    checkId: "claim_unsupported",
    name: "Claim Support Check",
  },
  {
    classification: "contradicted",
    checkId: "claim_contradicted",
    name: "Claim Contradiction Check",
  },
  {
    classification: "forbidden_claim",
    checkId: "forbidden_claim_used",
    name: "Forbidden Claim Check",
  },
];

export function evaluateProductTruth(
  claims: DerivedClaim[],
  triage: TriageResult[],
  findings: SubstantiationFinding[],
  options: { sourceEvidenceAvailable: boolean } = {
    sourceEvidenceAvailable: claims.length > 0,
  },
): MetricResult {
  const claimById = new Map(claims.map((c) => [c.claim_id, c]));

  const subChecks: SubCheckResult[] = PRODUCT_TRUTH_CHECKS.map((def) => {
    // An empty finding bucket is a pass only after the agent had transcript or
    // OCR evidence in which it could look for claims. With no source evidence,
    // each owned check must abstain instead of treating absence as proof.
    if (!options.sourceEvidenceAvailable) {
      return cannotAssess(
        def.checkId,
        def.name,
        "No transcript or OCR evidence was available for claim assessment.",
      );
    }

    const bucket = findings.filter((f) =>
      f.classification === def.classification
    );
    if (bucket.length === 0) return passed(def.checkId, def.name);

    const worst = bucket.reduce((w, f) => (f.severity > w.severity ? f : w));
    if (worst.severity === 0) return passed(def.checkId, def.name);

    return failed(
      def.checkId,
      def.name,
      mapSeverityScore(worst.severity) as Exclude<
        SeverityLevel,
        "none" | "cannot_assess"
      >,
      worst.issue_description,
    );
  });

  const flaggedFindings = findings.filter((f) => f.severity > 0);
  const evidenceRefs = dedupeEvidence(
    flaggedFindings.flatMap((f): EvidenceRef[] => {
      const claim = claimById.get(f.claim_id);
      const instanceEvidence = claim
        ? claim.instances.map((inst) =>
          evidence(inst.source, inst.text, inst.start_ms)
        )
        : [];
      const productPageEvidence = f.product_page_evidence.trim()
        ? [evidence("product_page", f.product_page_evidence)]
        : [];
      return [...instanceEvidence, ...productPageEvidence];
    }),
  );

  const worstFinding = findings.reduce<SubstantiationFinding | null>(
    (worst, f) => (!worst || f.severity > worst.severity ? f : worst),
    null,
  );
  const severity = highestFailedSeverity(subChecks);
  const failedOverall = severity !== "none";
  const cannotAssessOverall = !options.sourceEvidenceAvailable;
  const skippedCount = triage.filter((t) => !t.is_verifiable_claim).length;

  return {
    metric_id: "product_truth",
    agent: "claims_accuracy",
    metric_name: "Product Truth / Claim Support",
    question:
      "Are all explicit product claims supported by product page or source materials?",
    result: cannotAssessOverall
      ? "cannot_assess"
      : failedOverall
      ? "false"
      : "true",
    severity: cannotAssessOverall ? "cannot_assess" : severity,
    confidence: cannotAssessOverall
      ? "low"
      : worstFinding
      ? bucketConfidence(worstFinding.confidence_score)
      : "high",
    evidence: evidenceRefs,
    explanation: cannotAssessOverall
      ? "Product truth could not be assessed because no transcript or OCR evidence was available."
      : failedOverall && worstFinding
      ? worstFinding.issue_description
      : `${findings.length} claim(s) examined${
        skippedCount
          ? `, ${skippedCount} additional puffery statement(s) skipped`
          : ""
      }; none conflict with the product page.`,
    suggested_correction: failedOverall && worstFinding
      ? worstFinding.recommendation
      : undefined,
    correction_type: failedOverall ? "rewrite" : "none",
    sub_checks: subChecks,
  };
}

/* -------------------------------------------------------------------------- */
/* policy_compliance -- 4 fixed sub_checks, ad-wide, LLM-judged              */
/* -------------------------------------------------------------------------- */

/** Below this font size, disclaimer text is considered hard to read. */
const MIN_DISCLAIMER_FONT_PX = 12;
/** Below this duration, disclaimer text likely can't be read in time. */
const MIN_DISCLAIMER_DURATION_MS = 2000;

export function evaluatePolicyCompliance(
  assessment: AdWidePolicyAssessment,
  transcript: TranscriptSegment[],
  ocr: OCRSegment[],
): MetricResult {
  const subChecks: SubCheckResult[] = [];
  const evidenceRefs: EvidenceRef[] = [];

  // 1. missing_disclaimer -- semantic presence, entirely LLM-judged.
  const { disclaimer } = assessment;
  const disclaimerMissing = disclaimer.required && !disclaimer.present;

  if (disclaimerMissing) {
    subChecks.push(
      failed(
        "missing_disclaimer",
        "Disclaimer Presence",
        "critical",
        disclaimer.explanation ||
          "A required disclaimer was not found in the ad.",
      ),
    );
  } else {
    subChecks.push(passed("missing_disclaimer", "Disclaimer Presence"));
  }

  let matchedOcrSegment: OCRSegment | undefined;
  if (disclaimer.present && disclaimer.matched_segment_id) {
    if (disclaimer.matched_source === "ocr") {
      matchedOcrSegment = ocr.find((s) =>
        s.ocr_id === disclaimer.matched_segment_id
      );
      if (matchedOcrSegment) {
        evidenceRefs.push(
          evidence("ocr", matchedOcrSegment.text, matchedOcrSegment.start_ms),
        );
      }
    } else if (disclaimer.matched_source === "transcript") {
      const seg = transcript.find((s) =>
        s.segment_id === disclaimer.matched_segment_id
      );
      if (seg) {
        evidenceRefs.push(evidence("transcript", seg.text, seg.start_ms));
      }
    }
  }

  // 2 & 3. Contrast/duration only assessable when the disclaimer is
  // confirmed present AND on-screen (OCR) -- a spoken-only disclaimer, or a
  // missing one, has no font size or on-screen duration to evaluate.
  if (matchedOcrSegment) {
    const fontSize = matchedOcrSegment.font_size_px;
    if (fontSize !== undefined) {
      subChecks.push(
        fontSize < MIN_DISCLAIMER_FONT_PX
          ? failed(
            "disclaimer_contrast_low",
            "Disclaimer Visibility",
            "low",
            `The font size of the disclaimer text is ${fontSize}px, below the required ${MIN_DISCLAIMER_FONT_PX}px safe limit.`,
          )
          : passed("disclaimer_contrast_low", "Disclaimer Visibility"),
      );
    } else {
      subChecks.push(
        cannotAssess(
          "disclaimer_contrast_low",
          "Disclaimer Visibility",
          "No font size metadata available for the matched disclaimer segment.",
        ),
      );
    }

    const duration = matchedOcrSegment.on_screen_duration_ms;
    subChecks.push(
      duration < MIN_DISCLAIMER_DURATION_MS
        ? failed(
          "disclaimer_duration_insufficient",
          "Disclaimer Duration",
          "low",
          `The disclaimer was on screen for ${duration}ms, below the ${MIN_DISCLAIMER_DURATION_MS}ms readability minimum.`,
        )
        : passed("disclaimer_duration_insufficient", "Disclaimer Duration"),
    );
  } else {
    const reason = disclaimerMissing
      ? "No disclaimer was found to assess."
      : "The disclaimer was found only in spoken audio, not on-screen text -- contrast and duration don't apply.";
    subChecks.push(
      cannotAssess("disclaimer_contrast_low", "Disclaimer Visibility", reason),
    );
    subChecks.push(
      cannotAssess(
        "disclaimer_duration_insufficient",
        "Disclaimer Duration",
        reason,
      ),
    );
  }

  // 4. policy_violation_depicted
  const { policy_depiction } = assessment;
  if (policy_depiction.detected) {
    subChecks.push(
      failed(
        "policy_violation_depicted",
        "Policy Depiction Check",
        mapSeverityScore(policy_depiction.severity) as Exclude<
          SeverityLevel,
          "none" | "cannot_assess"
        >,
        policy_depiction.description,
      ),
    );
    if (policy_depiction.matched_segment_id) {
      if (policy_depiction.matched_source === "ocr") {
        const seg = ocr.find((s) =>
          s.ocr_id === policy_depiction.matched_segment_id
        );
        if (seg) evidenceRefs.push(evidence("ocr", seg.text, seg.start_ms));
      } else if (policy_depiction.matched_source === "transcript") {
        const seg = transcript.find((s) =>
          s.segment_id === policy_depiction.matched_segment_id
        );
        if (seg) {
          evidenceRefs.push(evidence("transcript", seg.text, seg.start_ms));
        }
      }
    }
  } else {
    subChecks.push(
      passed("policy_violation_depicted", "Policy Depiction Check"),
    );
  }

  const severity = highestFailedSeverity(subChecks);
  const failedOverall = severity !== "none";
  const worstFailed = worstFailedSubCheck(subChecks);

  const confidences = [
    disclaimer.confidence_score,
    policy_depiction.confidence_score,
  ];
  const avgConfidence = confidences.reduce((s, c) => s + c, 0) /
    confidences.length;

  return {
    metric_id: "policy_compliance",
    agent: "claims_accuracy",
    metric_name: "Policy / Compliance Readiness",
    question:
      "Does the video avoid obvious policy, compliance, or disclosure issues?",
    result: failedOverall ? "false" : "true",
    severity,
    confidence: bucketConfidence(avgConfidence),
    evidence: dedupeEvidence(evidenceRefs),
    explanation: failedOverall
      ? worstFailed?.explanation ?? "A policy compliance issue was found."
      : "Required disclaimers are present and no policy violations were detected.",
    suggested_correction: failedOverall
      ? (disclaimerMissing
        ? "Add the required disclaimer to the ad."
        : worstFailed?.explanation)
      : undefined,
    correction_type: failedOverall ? "edit_recommendation" : "none",
    sub_checks: subChecks,
  };
}
