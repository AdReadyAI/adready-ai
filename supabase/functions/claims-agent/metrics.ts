/**
 * metrics.ts — The pure, deterministic post-processing layer: no DB
 * access, no LLM calls, no I/O. Takes already-computed claims/findings
 * from checks.ts and produces the two schema-validated MetricResults.
 *
 * Severity/confidence helpers are kept local (not imported from a shared
 * module) since shared/index.ts's barrel doesn't currently export
 * equivalents -- small enough (a handful of one-liners) that duplicating
 * them here is simpler than depending on an unconfirmed shared API.
 */

import type {
  EvidenceRef,
  MetricResult,
  OCRSegment,
  ParsedCreativeBrief,
  SubCheckResult,
} from "../shared/index.ts";
import type {
  ComplianceFinding,
  DerivedClaim,
  SeverityScore,
  SubstantiationFinding,
  TriageResult,
} from "./checks.ts";

/* -------------------------------------------------------------------------- */
/* Local severity/confidence helpers                                         */
/* -------------------------------------------------------------------------- */

function msToTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
}

function mapSeverityScore(score: SeverityScore): MetricResult["severity"] {
  const table: Record<SeverityScore, MetricResult["severity"]> = {
    0: "none",
    1: "low",
    2: "medium",
    3: "high",
    4: "critical",
  };
  return table[score];
}

function worstSeverityScore(scores: SeverityScore[]): SeverityScore {
  return scores.length ? (Math.max(...scores) as SeverityScore) : 0;
}

function bucketConfidence(
  score: number,
): NonNullable<MetricResult["confidence"]> {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* -------------------------------------------------------------------------- */
/* product_truth                                                              */
/* -------------------------------------------------------------------------- */

export function evaluateProductTruth(
  claims: DerivedClaim[],
  triage: TriageResult[],
  findings: SubstantiationFinding[],
): MetricResult {
  const claimById = new Map(claims.map((c) => [c.claim_id, c]));

  const subChecks: SubCheckResult[] = findings.map((finding) => {
    const claim = claimById.get(finding.claim_id);
    return {
      check_id: finding.claim_id,
      name: claim ? truncate(claim.text) : finding.claim_id,
      result: finding.severity === 0 ? "passed" : "failed",
      severity: mapSeverityScore(finding.severity),
      explanation: finding.issue_description,
    };
  });

  // A flagged claim can occur more than once in the ad -- surface every
  // instance as evidence, not just one.
  const evidence: EvidenceRef[] = findings
    .filter((f) => f.severity > 0)
    .flatMap((f): EvidenceRef[] => {
      const claim = claimById.get(f.claim_id);
      if (!claim) return [];
      return claim.instances.map((inst) => ({
        type: inst.source,
        text: inst.text,
        timestamp: inst.timestamp,
      }));
    });

  const worstFinding = findings.reduce<SubstantiationFinding | null>(
    (worst, f) => (!worst || f.severity > worst.severity ? f : worst),
    null,
  );
  const worstScore = worstSeverityScore(findings.map((f) => f.severity));
  const severity = mapSeverityScore(worstScore);
  const failed = worstScore > 0;
  const skippedCount = triage.filter((t) => !t.is_verifiable_claim).length;

  return {
    metric_id: "product_truth",
    agent: "claims_accuracy",
    metric_name: "Product Truth / Claim Support",
    question:
      "Are all explicit product claims supported by product page or source materials?",
    result: failed ? "false" : "true",
    severity,
    confidence: worstFinding
      ? bucketConfidence(worstFinding.confidence_score)
      : "high",
    evidence,
    explanation: failed && worstFinding
      ? worstFinding.issue_description
      : `${findings.length} claim(s) examined${
        skippedCount
          ? `, ${skippedCount} additional puffery statement(s) skipped`
          : ""
      }; none conflict with the product page.`,
    suggested_correction: failed && worstFinding
      ? worstFinding.recommendation
      : undefined,
    correction_type: failed ? "rewrite" : "none",
    sub_checks: subChecks,
  };
}

/* -------------------------------------------------------------------------- */
/* policy_compliance                                                          */
/* -------------------------------------------------------------------------- */

export function evaluatePolicyCompliance(
  claims: DerivedClaim[],
  ocr: OCRSegment[],
  findings: ComplianceFinding[],
  brief: ParsedCreativeBrief,
): MetricResult {
  const claimById = new Map(claims.map((c) => [c.claim_id, c]));
  const subChecks: SubCheckResult[] = [];
  const evidence: EvidenceRef[] = [];

  // Deterministic, ad-wide check: does a required disclaimer exist at all?
  const disclaimerSeg = ocr.find((s) =>
    s.text.toLowerCase().includes("disclaimer") ||
    s.text.toLowerCase().includes("results may vary")
  );
  const requiresDisclaimer = brief.policy_requirements.some((p) =>
    p.toLowerCase().includes("disclaimer")
  );
  const missingDisclaimer = requiresDisclaimer && !disclaimerSeg;

  if (missingDisclaimer) {
    subChecks.push({
      check_id: "missing_disclaimer",
      name: "Disclaimer presence",
      result: "failed",
      severity: "critical",
      explanation:
        "Brief requires a disclaimer but none was detected in OCR text.",
    });
  } else {
    subChecks.push({
      check_id: "missing_disclaimer",
      name: "Disclaimer presence",
      result: "passed",
      severity: "none",
    });
    if (disclaimerSeg) {
      evidence.push({
        type: "ocr",
        text: disclaimerSeg.text,
        timestamp: msToTimestamp(disclaimerSeg.start_ms),
      });
    }
  }

  // Dynamic, per-claim checks from the compliance agent.
  for (const finding of findings) {
    const claim = claimById.get(finding.claim_id);
    subChecks.push({
      check_id: finding.claim_id,
      name: claim ? truncate(claim.text) : finding.claim_id,
      result: finding.severity === 0 ? "passed" : "failed",
      severity: mapSeverityScore(finding.severity),
      explanation: finding.issue_description,
    });
    if (finding.severity > 0 && claim) {
      for (const inst of claim.instances) {
        evidence.push({
          type: inst.source,
          text: inst.text,
          timestamp: inst.timestamp,
        });
      }
      if (finding.policy_excerpt) {
        // NOTE: EvidenceRef.type has no "regulatory_guidance" option in
        // shared/schemas.ts -- mapped to "metadata" as a placeholder.
        evidence.push({
          type: "metadata",
          text: finding.policy_excerpt,
          timestamp: "",
        });
      }
    }
  }

  const globalSeverityScore: SeverityScore = missingDisclaimer ? 4 : 0;
  const worstScore = Math.max(
    globalSeverityScore,
    worstSeverityScore(findings.map((f) => f.severity)),
  ) as SeverityScore;
  const severity = mapSeverityScore(worstScore);
  const failed = worstScore > 0;

  const worstFinding = findings.reduce<ComplianceFinding | null>(
    (worst, f) => (!worst || f.severity > worst.severity ? f : worst),
    null,
  );

  return {
    metric_id: "policy_compliance",
    agent: "claims_accuracy",
    metric_name: "Policy / Compliance Readiness",
    question:
      "Does the video avoid obvious policy, compliance, or disclosure issues?",
    result: failed ? "false" : "true",
    severity,
    confidence: worstFinding
      ? bucketConfidence(worstFinding.confidence_score)
      : "medium",
    evidence,
    explanation: missingDisclaimer
      ? "A required disclaimer is missing from the ad entirely."
      : failed && worstFinding
      ? worstFinding.issue_description
      : "Required disclaimers are present and no examined claim raised a compliance concern.",
    suggested_correction: failed
      ? (worstFinding
        ? worstFinding.recommendation
        : "Add the required disclaimer to the ad.")
      : undefined,
    correction_type: failed ? "edit_recommendation" : "none",
    sub_checks: subChecks,
  };
}
