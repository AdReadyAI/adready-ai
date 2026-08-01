/**
 * metrics.test.ts — Unit tests for the pure synthesis functions in
 * metrics.ts: evaluateProductTruth and evaluatePolicyCompliance.
 *
 * Run with:
 *   deno test --allow-none claims-agent/metrics.test.ts
 */

import { assert, assertEquals } from "@std/assert";

import {
  evaluatePolicyCompliance,
  evaluateProductTruth,
} from "../../../../functions/claims-agent/metrics.ts";

import {
  BASE_BRIEF,
  BRIEF_REQUIRES_DISCLAIMER,
  buildClaim,
  buildComplianceFinding,
  buildDisclaimerOcrSegment,
  buildSubstantiationFinding,
  buildTriage,
  SHARED_INSTANCE,
} from "./fixtures.ts";

// ---------------------------------------------------------------------------
// evaluateProductTruth
// ---------------------------------------------------------------------------

Deno.test("evaluateProductTruth: all findings passing yields true/none/no failures", () => {
  const result = evaluateProductTruth(
    [buildClaim()],
    [buildTriage()],
    [buildSubstantiationFinding({ severity: 0 })],
  );

  assertEquals(result.result, "true");
  assertEquals(result.severity, "none");
  assertEquals(result.suggested_correction, undefined);
  assertEquals(result.correction_type, "none");
  assertEquals(result.metric_id, "product_truth");
});

Deno.test("evaluateProductTruth: a single failing finding drives result/severity/correction", () => {
  const result = evaluateProductTruth(
    [buildClaim()],
    [buildTriage()],
    [
      buildSubstantiationFinding({
        severity: 3,
        issue_description: "exaggerated claim",
        recommendation: "soften wording",
        confidence_score: 0.9,
      }),
    ],
  );

  assertEquals(result.result, "false");
  assertEquals(result.severity, "high");
  assertEquals(result.explanation, "exaggerated claim");
  assertEquals(result.suggested_correction, "soften wording");
  assertEquals(result.correction_type, "rewrite");
});

Deno.test("evaluateProductTruth: worst severity among multiple failed findings wins", () => {
  const result = evaluateProductTruth(
    [buildClaim({ claim_id: "claim-1" }), buildClaim({ claim_id: "claim-2" })],
    [
      buildTriage({ claim_id: "claim-1" }),
      buildTriage({ claim_id: "claim-2" }),
    ],
    [
      buildSubstantiationFinding({ claim_id: "claim-1", severity: 1 }),
      buildSubstantiationFinding({ claim_id: "claim-2", severity: 4 }),
    ],
  );

  assertEquals(result.severity, "critical");
});

Deno.test("evaluateProductTruth: dedupes identical evidence entries across claims", () => {
  // Two different claims whose extraction happened to cite the exact same
  // underlying segment (same text/source/timestamp) -- both fail, both
  // contribute the same evidence line.
  const result = evaluateProductTruth(
    [
      buildClaim({ claim_id: "claim-1", instances: [SHARED_INSTANCE] }),
      buildClaim({ claim_id: "claim-2", instances: [SHARED_INSTANCE] }),
    ],
    [
      buildTriage({ claim_id: "claim-1" }),
      buildTriage({ claim_id: "claim-2" }),
    ],
    [
      buildSubstantiationFinding({ claim_id: "claim-1", severity: 2 }),
      buildSubstantiationFinding({ claim_id: "claim-2", severity: 2 }),
    ],
  );

  assertEquals(result.evidence?.length, 1);
});

Deno.test("evaluateProductTruth: confidence buckets from the worst finding's confidence_score", () => {
  const high = evaluateProductTruth(
    [buildClaim()],
    [buildTriage()],
    [buildSubstantiationFinding({ severity: 2, confidence_score: 0.9 })],
  );
  const medium = evaluateProductTruth(
    [buildClaim()],
    [buildTriage()],
    [buildSubstantiationFinding({ severity: 2, confidence_score: 0.6 })],
  );
  const low = evaluateProductTruth(
    [buildClaim()],
    [buildTriage()],
    [buildSubstantiationFinding({ severity: 2, confidence_score: 0.3 })],
  );

  assertEquals(high.confidence, "high");
  assertEquals(medium.confidence, "medium");
  assertEquals(low.confidence, "low");
});

Deno.test("evaluateProductTruth: no findings at all defaults to true/high-confidence", () => {
  const result = evaluateProductTruth([], [], []);

  assertEquals(result.result, "true");
  assertEquals(result.confidence, "high");
});

Deno.test("evaluateProductTruth: explanation counts skipped puffery when nothing failed", () => {
  const result = evaluateProductTruth(
    [buildClaim()],
    [
      buildTriage(),
      buildTriage({
        claim_id: "claim-2",
        is_verifiable_claim: false,
        category: null,
      }),
    ],
    [buildSubstantiationFinding({ severity: 0 })],
  );

  assert(result.explanation?.includes("puffery"));
});

// ---------------------------------------------------------------------------
// evaluatePolicyCompliance
// ---------------------------------------------------------------------------

Deno.test("evaluatePolicyCompliance: missing required disclaimer drives explanation AND suggested_correction", () => {
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [], // no OCR segments -- no disclaimer present
    [buildComplianceFinding({ severity: 0 })], // per-claim findings all pass
    BRIEF_REQUIRES_DISCLAIMER,
  );

  assertEquals(result.result, "false");
  assertEquals(result.severity, "critical");
  assertEquals(
    result.explanation,
    "A required disclaimer is missing from the ad entirely.",
  );
  assertEquals(
    result.suggested_correction,
    "Add the required disclaimer to the ad.",
  );
});

Deno.test("evaluatePolicyCompliance: missing disclaimer takes priority in suggested_correction even when a claim also fails", () => {
  // Regression test for the bug where suggested_correction ignored
  // missingDisclaimer whenever any per-claim finding existed.
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [],
    [
      buildComplianceFinding({
        severity: 3,
        recommendation: "add substantiation for energy claim",
      }),
    ],
    BRIEF_REQUIRES_DISCLAIMER,
  );

  assertEquals(
    result.suggested_correction,
    "Add the required disclaimer to the ad.",
  );
});

Deno.test("evaluatePolicyCompliance: disclaimer present is detected via OCR and adds evidence", () => {
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [buildDisclaimerOcrSegment()],
    [buildComplianceFinding({ severity: 0 })],
    BRIEF_REQUIRES_DISCLAIMER,
  );

  const disclaimerCheck = result.sub_checks?.find((c) =>
    c.check_id === "missing_disclaimer"
  );
  assertEquals(disclaimerCheck?.result, "passed");
  assertEquals(result.evidence?.some((e) => e.type === "ocr"), true);
});

Deno.test("evaluatePolicyCompliance: disclaimer not required means absence doesn't fail the check", () => {
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [],
    [buildComplianceFinding({ severity: 0 })],
    BASE_BRIEF, // no policy_requirements mentioning a disclaimer
  );

  const disclaimerCheck = result.sub_checks?.find((c) =>
    c.check_id === "missing_disclaimer"
  );
  assertEquals(disclaimerCheck?.result, "passed");
  assertEquals(result.result, "true");
});

Deno.test("evaluatePolicyCompliance: a failing per-claim finding adds both instance and policy_excerpt evidence", () => {
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [],
    [
      buildComplianceFinding({
        severity: 4,
        policy_excerpt: "must be substantiated",
      }),
    ],
    BASE_BRIEF,
  );

  assertEquals(result.evidence?.some((e) => e.type === "transcript"), true);
  assertEquals(
    result.evidence?.some((e) =>
      e.type === "metadata" && e.text === "must be substantiated"
    ),
    true,
  );
});

Deno.test("evaluatePolicyCompliance: passing findings add no evidence", () => {
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [],
    [buildComplianceFinding({ severity: 0 })],
    BASE_BRIEF,
  );

  assertEquals(result.evidence?.length, 0);
});

Deno.test("evaluatePolicyCompliance: missing disclaimer (critical) outranks a lower-severity finding", () => {
  const result = evaluatePolicyCompliance(
    [buildClaim()],
    [],
    [buildComplianceFinding({ severity: 1 })],
    BRIEF_REQUIRES_DISCLAIMER,
  );

  assertEquals(result.severity, "critical");
});

Deno.test("evaluatePolicyCompliance: dedupes identical evidence entries", () => {
  const result = evaluatePolicyCompliance(
    [
      buildClaim({ claim_id: "claim-1", instances: [SHARED_INSTANCE] }),
      buildClaim({ claim_id: "claim-2", instances: [SHARED_INSTANCE] }),
    ],
    [],
    [
      buildComplianceFinding({ claim_id: "claim-1", severity: 2 }),
      buildComplianceFinding({ claim_id: "claim-2", severity: 2 }),
    ],
    BASE_BRIEF,
  );

  assertEquals(result.evidence?.length, 1);
});
