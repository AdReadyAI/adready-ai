/**
 * metrics.test.ts — Unit tests for the pure synthesis functions in
 * metrics.ts: evaluateProductTruth and evaluatePolicyCompliance.
 *
 * deno test --config supabase/deno.json supabase/tests/functions/unit/claims/metrics.test.ts
 */

import { assert, assertEquals } from "@std/assert";

import {
  evaluatePolicyCompliance,
  evaluateProductTruth,
} from "../../../../functions/claims-agent/metrics.ts";

import {
  buildAdWidePolicyAssessment,
  buildClaim,
  buildDisclaimerOcrSegment,
  buildDisclaimerTranscriptSegment,
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

Deno.test("evaluateProductTruth: sub_checks are always the 3 fixed checks, keyed by classification", () => {
  const result = evaluateProductTruth(
    [buildClaim({ claim_id: "claim-1" }), buildClaim({ claim_id: "claim-2" })],
    [
      buildTriage({ claim_id: "claim-1" }),
      buildTriage({ claim_id: "claim-2" }),
    ],
    [
      buildSubstantiationFinding({
        claim_id: "claim-1",
        classification: "unsupported",
        severity: 2,
      }),
      buildSubstantiationFinding({
        claim_id: "claim-2",
        classification: "forbidden_claim",
        severity: 4,
      }),
    ],
  );

  const ids = result.sub_checks?.map((c) => c.check_id).sort();
  assertEquals(ids, [
    "claim_contradicted",
    "claim_unsupported",
    "forbidden_claim_used",
  ]);

  const unsupported = result.sub_checks?.find((c) =>
    c.check_id === "claim_unsupported"
  );
  const contradicted = result.sub_checks?.find((c) =>
    c.check_id === "claim_contradicted"
  );
  const forbidden = result.sub_checks?.find((c) =>
    c.check_id === "forbidden_claim_used"
  );

  assertEquals(unsupported?.result, "failed");
  assertEquals(contradicted?.result, "passed");
  assertEquals(forbidden?.result, "failed");
});

Deno.test("evaluateProductTruth: dedupes identical evidence entries across claims", () => {
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
      buildSubstantiationFinding({
        claim_id: "claim-1",
        classification: "unsupported",
        severity: 2,
      }),
      buildSubstantiationFinding({
        claim_id: "claim-2",
        classification: "unsupported",
        severity: 2,
      }),
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

Deno.test("evaluatePolicyCompliance: missing required disclaimer drives explanation, suggested_correction, and severity", () => {
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: false,
      explanation: "No disclaimer found anywhere in the ad.",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], []);

  assertEquals(result.result, "false");
  assertEquals(result.severity, "critical");
  assertEquals(result.explanation, "No disclaimer found anywhere in the ad.");
  assertEquals(
    result.suggested_correction,
    "Add the required disclaimer to the ad.",
  );
});

Deno.test("evaluatePolicyCompliance: disclaimer not required means absence doesn't fail the check", () => {
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: { required: false, present: false },
  });

  const result = evaluatePolicyCompliance(assessment, [], []);

  const disclaimerCheck = result.sub_checks?.find((c) =>
    c.check_id === "missing_disclaimer"
  );
  assertEquals(disclaimerCheck?.result, "passed");
});

Deno.test("evaluatePolicyCompliance: disclaimer matched via OCR resolves real evidence and enables contrast/duration checks", () => {
  const ocrSeg = buildDisclaimerOcrSegment({
    font_size_px: 16,
    on_screen_duration_ms: 3000,
  });
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: true,
      matched_segment_id: ocrSeg.ocr_id,
      matched_source: "ocr",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], [ocrSeg]);

  assertEquals(
    result.evidence?.some((e) => e.type === "ocr" && e.text === ocrSeg.text),
    true,
  );
  const contrastCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_contrast_low"
  );
  const durationCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_duration_insufficient"
  );
  assertEquals(contrastCheck?.result, "passed");
  assertEquals(durationCheck?.result, "passed");
});

Deno.test("evaluatePolicyCompliance: disclaimer matched via transcript (spoken) resolves evidence but skips contrast/duration", () => {
  const transcriptSeg = buildDisclaimerTranscriptSegment();
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: true,
      matched_segment_id: transcriptSeg.segment_id,
      matched_source: "transcript",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [transcriptSeg], []);

  assertEquals(
    result.evidence?.some((e) =>
      e.type === "transcript" && e.text === transcriptSeg.text
    ),
    true,
  );
  const contrastCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_contrast_low"
  );
  const durationCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_duration_insufficient"
  );
  assertEquals(contrastCheck?.result, "cannot_assess");
  assertEquals(durationCheck?.result, "cannot_assess");
});

Deno.test("evaluatePolicyCompliance: disclaimer missing entirely -> contrast/duration are cannot_assess, not passed", () => {
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: { required: true, present: false },
  });

  const result = evaluatePolicyCompliance(assessment, [], []);

  const contrastCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_contrast_low"
  );
  const durationCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_duration_insufficient"
  );
  assertEquals(contrastCheck?.result, "cannot_assess");
  assertEquals(durationCheck?.result, "cannot_assess");
});

Deno.test("evaluatePolicyCompliance: font size below minimum fails disclaimer_contrast_low", () => {
  const ocrSeg = buildDisclaimerOcrSegment({
    font_size_px: 10,
    on_screen_duration_ms: 3000,
  });
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: true,
      matched_segment_id: ocrSeg.ocr_id,
      matched_source: "ocr",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], [ocrSeg]);

  const contrastCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_contrast_low"
  );
  assertEquals(contrastCheck?.result, "failed");
  assertEquals(contrastCheck?.severity, "low");
});

Deno.test("evaluatePolicyCompliance: on-screen duration below minimum fails disclaimer_duration_insufficient", () => {
  const ocrSeg = buildDisclaimerOcrSegment({
    font_size_px: 16,
    on_screen_duration_ms: 500,
  });
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: true,
      matched_segment_id: ocrSeg.ocr_id,
      matched_source: "ocr",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], [ocrSeg]);

  const durationCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_duration_insufficient"
  );
  assertEquals(durationCheck?.result, "failed");
});

Deno.test("evaluatePolicyCompliance: font size metadata missing -> cannot_assess, not a silent pass", () => {
  const ocrSeg = buildDisclaimerOcrSegment({
    font_size_px: undefined,
    on_screen_duration_ms: 3000,
  });
  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: true,
      matched_segment_id: ocrSeg.ocr_id,
      matched_source: "ocr",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], [ocrSeg]);

  const contrastCheck = result.sub_checks?.find((c) =>
    c.check_id === "disclaimer_contrast_low"
  );
  assertEquals(contrastCheck?.result, "cannot_assess");
});

Deno.test("evaluatePolicyCompliance: policy_depiction detected resolves real evidence from the matched segment", () => {
  const ocrSeg = buildDisclaimerOcrSegment({
    ocr_id: "o-violation",
    text: "banned substance logo",
  });
  const assessment = buildAdWidePolicyAssessment({
    policy_depiction: {
      detected: true,
      severity: 3,
      description: "Depicts a recognizable illegal substance logo.",
      matched_segment_id: "o-violation",
      matched_source: "ocr",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], [ocrSeg]);

  const depictionCheck = result.sub_checks?.find((c) =>
    c.check_id === "policy_violation_depicted"
  );
  assertEquals(depictionCheck?.result, "failed");
  assertEquals(depictionCheck?.severity, "high");
  assertEquals(
    result.evidence?.some((e) =>
      e.type === "ocr" && e.text === "banned substance logo"
    ),
    true,
  );
});

Deno.test("evaluatePolicyCompliance: policy_depiction not detected passes with no evidence", () => {
  const assessment = buildAdWidePolicyAssessment(); // defaults: policy_depiction.detected = false

  const result = evaluatePolicyCompliance(assessment, [], []);

  const depictionCheck = result.sub_checks?.find((c) =>
    c.check_id === "policy_violation_depicted"
  );
  assertEquals(depictionCheck?.result, "passed");
  assertEquals(result.evidence?.length, 0);
});

Deno.test("evaluatePolicyCompliance: explanation/suggested_correction reflect the WORST failed check, not just the first one pushed", () => {
  // Regression test: missing_disclaimer is pushed first but here is only
  // "low"-adjacent (not applicable since it's not failing); instead a
  // low-severity contrast failure is pushed before a high-severity
  // policy_depiction failure -- the top-level explanation must reflect
  // the depiction issue (higher severity), not the contrast issue (first
  // pushed).
  const ocrSeg = buildDisclaimerOcrSegment({
    ocr_id: "o-disclaimer",
    font_size_px: 8, // fails contrast, severity "low"
    on_screen_duration_ms: 3000,
  });
  const violationSeg = buildDisclaimerOcrSegment({
    ocr_id: "o-violation",
    text: "unsafe stunt depicted",
  });

  const assessment = buildAdWidePolicyAssessment({
    disclaimer: {
      required: true,
      present: true,
      matched_segment_id: "o-disclaimer",
      matched_source: "ocr",
    },
    policy_depiction: {
      detected: true,
      severity: 4,
      description:
        "Depicts a dangerous safety hazard with no mitigating context.",
      matched_segment_id: "o-violation",
      matched_source: "ocr",
    },
  });

  const result = evaluatePolicyCompliance(assessment, [], [
    ocrSeg,
    violationSeg,
  ]);

  assertEquals(result.severity, "critical");
  assertEquals(
    result.explanation,
    "Depicts a dangerous safety hazard with no mitigating context.",
  );
});

Deno.test("evaluatePolicyCompliance: sub_checks always includes all four fixed checks", () => {
  const assessment = buildAdWidePolicyAssessment();

  const result = evaluatePolicyCompliance(assessment, [], []);

  const ids = result.sub_checks?.map((c) => c.check_id).sort();
  assertEquals(
    ids,
    [
      "disclaimer_contrast_low",
      "disclaimer_duration_insufficient",
      "missing_disclaimer",
      "policy_violation_depicted",
    ].sort(),
  );
});
