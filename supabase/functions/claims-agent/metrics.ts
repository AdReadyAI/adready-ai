/**
 * metrics.ts — The pure, deterministic post-processing layer: no DB access,
 * no LLM calls, no I/O. Takes already-fetched claims/findings and produces
 * the two schema-validated MetricResults, plus the anti-hallucination guard
 * that runs on compliance findings before synthesis sees them.
 *
 * Never needs to change when swapping out any tool in ./tools/ -- these
 * functions only see already-computed data.
 */

import type {
  EvidenceRef,
  MetricResult,
  OCRSegment,
  ParsedCreativeBrief,
  SubCheckResult,
} from "../shared/schemas.ts";
import type {
  ClaimCategory,
  ComplianceFinding,
  DerivedClaim,
  EvidenceByCategory,
  SeverityScore,
  SubstantiationFinding,
  TriageResult,
  VerifiableClaim,
} from "./types.ts";
import {
  bucketConfidence,
  mapSeverityScore,
  msToTimestamp,
  truncate,
  worstSeverityScore,
} from "./utils.ts";

// Anti-hallucination guard

const UNVERIFIED_CONFIDENCE_CAP = 0.3;

/**
 * Cross-checks every non-empty policy_excerpt against the regulatory
 * evidence actually retrieved for that claim's category. If the excerpt
 * isn't found verbatim (case-insensitive), it's dropped and confidence is
 * capped -- the safety net against a model inventing a plausible-sounding
 * regulation.
 */
export function verifyPolicyExcerpts(
  findings: ComplianceFinding[],
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
): ComplianceFinding[] {
  const categoryByClaimId = new Map<string, ClaimCategory>(
    claims.map((c) => [c.claim_id, c.category]),
  );

  return findings.map((finding) => {
    if (!finding.policy_excerpt) {
      return { ...finding, excerpt_verified: true };
    }

    const category = categoryByClaimId.get(finding.claim_id);
    const chunks = category ? evidence[category] ?? [] : [];
    const excerptLower = finding.policy_excerpt.toLowerCase();
    const verified = chunks.some((chunk) =>
      chunk.text.toLowerCase().includes(excerptLower)
    );

    if (verified) {
      return { ...finding, excerpt_verified: true };
    }

    return {
      ...finding,
      policy_excerpt: "",
      excerpt_verified: false,
      confidence_score: Math.min(
        finding.confidence_score,
        UNVERIFIED_CONFIDENCE_CAP,
      ),
    };
  });
}

//product_truth

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
  // instance as evidence, not just one, so the correction covers every
  // place the claim actually appears.
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

//policy_compliance

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
  // Independent of any single claim, so it isn't something the per-claim
  // compliance agent judges.
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
        // NOTE: EvidenceRef.type has no "regulatory_guidance" option yet in shared/schemas.ts
        //  mapped to "metadata" as a placeholder until that enum is extended.
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
