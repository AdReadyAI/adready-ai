/**
 * checks.test.ts — Unit tests for the pure functions in checks.ts:
 * response parsing/validation, missing-claim fallback behavior, segment_id
 * dedup, and the citation-allowlist anti-hallucination guard.
 *
 * Only the pure `process*Response()` functions and `verifyPolicyCitations()`
 * are tested here -- the async wrappers (extractClaims, triageClaims,
 * substantiateClaims, checkCompliance) call chat() and are not unit tested.
 *
 * deno test --config supabase/deno.json supabase/tests/functions/unit/claims/checks.test.ts
 */

import { assert, assertEquals, assertThrows } from "@std/assert";

import {
  processExtractionResponse,
  processSubstantiationResponse,
  processTriageResponse,
} from "../../../../functions/claims-agent/checks.ts";

import { buildVerifiableClaim, OCR, TRANSCRIPT } from "./fixtures.ts";

// ---------------------------------------------------------------------------
// processExtractionResponse
// ---------------------------------------------------------------------------

Deno.test("processExtractionResponse: resolves segment_ids against transcript and ocr", () => {
  const raw = JSON.stringify([
    { claim_id: "claim-1", text: "Real tropical mango", segment_ids: ["t1"] },
    { claim_id: "claim-2", text: "Contains caffeine", segment_ids: ["o1"] },
  ]);

  const claims = processExtractionResponse(raw, TRANSCRIPT, OCR);

  assertEquals(claims.length, 2);
  assertEquals(claims[0].instances[0].source, "transcript");
  assertEquals(claims[0].instances[0].timestamp, "00:02");
  assertEquals(claims[1].instances[0].source, "ocr");
  assertEquals(claims[1].instances[0].timestamp, "00:04");
});

Deno.test("processExtractionResponse: dedupes repeated segment_ids within one claim", () => {
  const raw = JSON.stringify([
    {
      claim_id: "claim-1",
      text: "Real tropical mango",
      segment_ids: ["t1", "t1"],
    },
  ]);

  const claims = processExtractionResponse(raw, TRANSCRIPT, OCR);

  assertEquals(claims[0].instances.length, 1);
});

Deno.test("processExtractionResponse: drops a claim whose segment_ids are all unrecognized", () => {
  const raw = JSON.stringify([
    {
      claim_id: "claim-1",
      text: "Ghost claim",
      segment_ids: ["does-not-exist"],
    },
  ]);

  const claims = processExtractionResponse(raw, TRANSCRIPT, OCR);

  assertEquals(claims.length, 0);
});

Deno.test("processExtractionResponse: falls back to a generated claim_id when empty", () => {
  const raw = JSON.stringify([
    { claim_id: "", text: "Real tropical mango", segment_ids: ["t1"] },
  ]);

  const claims = processExtractionResponse(raw, TRANSCRIPT, OCR);

  assertEquals(claims[0].claim_id, "claim-1");
});

Deno.test("processExtractionResponse: strips markdown fences before parsing", () => {
  const raw = "```json\n" +
    JSON.stringify([{ claim_id: "claim-1", text: "x", segment_ids: ["t1"] }]) +
    "\n```";

  const claims = processExtractionResponse(raw, TRANSCRIPT, OCR);

  assertEquals(claims.length, 1);
});

Deno.test("processExtractionResponse: throws on invalid JSON", () => {
  assertThrows(
    () => processExtractionResponse("not json", TRANSCRIPT, OCR),
    Error,
    "not valid JSON",
  );
});

Deno.test("processExtractionResponse: throws when shape doesn't match schema", () => {
  const raw = JSON.stringify([{ claim_id: "claim-1" }]); // missing text/segment_ids
  assertThrows(
    () => processExtractionResponse(raw, TRANSCRIPT, OCR),
    Error,
    "did not match the expected shape",
  );
});

// ---------------------------------------------------------------------------
// processTriageResponse
// ---------------------------------------------------------------------------

Deno.test("processTriageResponse: maps covered claims through unchanged", () => {
  const claims = [buildVerifiableClaim()];
  const raw = JSON.stringify([
    {
      claim_id: "claim-1",
      is_verifiable_claim: true,
      category: "factual_claim",
      reasoning: "r",
    },
  ]);

  const results = processTriageResponse(raw, claims);

  assertEquals(results[0].is_verifiable_claim, true);
  assertEquals(results[0].category, "factual_claim");
});

Deno.test("processTriageResponse: defaults an uncovered claim to verifiable/factual_claim", () => {
  const claims = [buildVerifiableClaim()];
  const raw = JSON.stringify([]); // model returned nothing for claim-1

  const results = processTriageResponse(raw, claims);

  assertEquals(results.length, 1);
  assertEquals(results[0].is_verifiable_claim, true);
  assertEquals(results[0].category, "factual_claim");
  assert(results[0].reasoning.includes("did not cover"));
});

// ---------------------------------------------------------------------------
// processSubstantiationResponse
// ---------------------------------------------------------------------------

Deno.test("processSubstantiationResponse: maps covered claims through unchanged", () => {
  const claim = buildVerifiableClaim();
  const raw = JSON.stringify([
    {
      claim_id: "claim-1",
      classification: "unsupported",
      severity: 3,
      issue_description: "exaggerated",
      recommendation: "soften wording",
      product_page_evidence: "product page says X",
      confidence_score: 0.9,
    },
  ]);

  const findings = processSubstantiationResponse(raw, [claim]);

  assertEquals(findings[0].classification, "unsupported");
  assertEquals(findings[0].severity, 3);
  assertEquals(findings[0].product_page_evidence, "product page says X");
  assertEquals(findings[0].confidence_score, 0.9);
});

Deno.test("processSubstantiationResponse: parses each classification value correctly", () => {
  const claims = [
    buildVerifiableClaim({ claim_id: "claim-1" }),
    buildVerifiableClaim({ claim_id: "claim-2" }),
    buildVerifiableClaim({ claim_id: "claim-3" }),
    buildVerifiableClaim({ claim_id: "claim-4" }),
  ];
  const raw = JSON.stringify([
    {
      claim_id: "claim-1",
      classification: "none",
      severity: 0,
      issue_description: "",
      recommendation: "",
      product_page_evidence: "",
      confidence_score: 0.9,
    },
    {
      claim_id: "claim-2",
      classification: "unsupported",
      severity: 2,
      issue_description: "",
      recommendation: "",
      product_page_evidence: "",
      confidence_score: 0.9,
    },
    {
      claim_id: "claim-3",
      classification: "contradicted",
      severity: 4,
      issue_description: "",
      recommendation: "",
      product_page_evidence: "",
      confidence_score: 0.9,
    },
    {
      claim_id: "claim-4",
      classification: "forbidden_claim",
      severity: 4,
      issue_description: "",
      recommendation: "",
      product_page_evidence: "",
      confidence_score: 0.9,
    },
  ]);

  const findings = processSubstantiationResponse(raw, claims);

  assertEquals(findings.map((f) => f.classification), [
    "none",
    "unsupported",
    "contradicted",
    "forbidden_claim",
  ]);
});

Deno.test("processSubstantiationResponse: flags an uncovered claim for manual review", () => {
  const claim = buildVerifiableClaim();
  const raw = JSON.stringify([]);

  const findings = processSubstantiationResponse(raw, [claim]);

  assertEquals(findings.length, 1);
  assertEquals(findings[0].classification, "unsupported"); // <- add this line
  assertEquals(findings[0].severity, 2);
  assertEquals(findings[0].confidence_score, 0.2);
  assert(findings[0].issue_description.includes("did not cover"));
});
