/**
 * checks.test.ts — Unit tests for the pure functions in checks.ts:
 * response parsing/validation, missing-claim fallback behavior, segment_id
 * dedup, and the anti-hallucination excerpt-verification guard.
 *
 * Only the pure `process*Response()` functions and `verifyPolicyExcerpts()`
 * are tested here -- the async wrappers (extractClaims, triageClaims,
 * substantiateClaims, checkCompliance) call chat() and are not unit tested.
 *
 * Run with:
 *   deno test --allow-none claims-agent/checks.test.ts
 */

import { assert, assertEquals, assertThrows } from "@std/assert";

import {
  processComplianceResponse,
  processExtractionResponse,
  processSubstantiationResponse,
  processTriageResponse,
  verifyPolicyExcerpts,
} from "../../../../functions/claims-agent/checks.ts";
import type { EvidenceByCategory } from "../../../../functions/claims-agent/checks.ts";

import {
  buildComplianceFinding,
  buildVerifiableClaim,
  OCR,
  TRANSCRIPT,
} from "./fixtures.ts";

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
      severity: 3,
      issue_description: "exaggerated",
      recommendation: "soften wording",
      confidence_score: 0.9,
    },
  ]);

  const findings = processSubstantiationResponse(raw, [claim]);

  assertEquals(findings[0].severity, 3);
  assertEquals(findings[0].confidence_score, 0.9);
});

Deno.test("processSubstantiationResponse: flags an uncovered claim for manual review", () => {
  const claim = buildVerifiableClaim();
  const raw = JSON.stringify([]);

  const findings = processSubstantiationResponse(raw, [claim]);

  assertEquals(findings.length, 1);
  assertEquals(findings[0].severity, 2);
  assertEquals(findings[0].confidence_score, 0.2);
  assert(findings[0].issue_description.includes("did not cover"));
});

// ---------------------------------------------------------------------------
// processComplianceResponse
// ---------------------------------------------------------------------------

Deno.test("processComplianceResponse: maps covered claims and marks excerpt_verified false", () => {
  const claim = buildVerifiableClaim();
  const raw = JSON.stringify([
    {
      claim_id: "claim-1",
      severity: 4,
      policy_excerpt: "must be substantiated",
      issue_description: "unsupported health claim",
      recommendation: "add disclosure",
      confidence_score: 0.85,
    },
  ]);

  const findings = processComplianceResponse(raw, [claim]);

  assertEquals(findings[0].severity, 4);
  assertEquals(findings[0].excerpt_verified, false); // always false pre-verification
});

Deno.test("processComplianceResponse: flags an uncovered claim for manual review", () => {
  const claim = buildVerifiableClaim();
  const raw = JSON.stringify([]);

  const findings = processComplianceResponse(raw, [claim]);

  assertEquals(findings[0].severity, 2);
  assertEquals(findings[0].policy_excerpt, "");
  assertEquals(findings[0].excerpt_verified, false);
});

// ---------------------------------------------------------------------------
// verifyPolicyExcerpts
// ---------------------------------------------------------------------------

Deno.test("verifyPolicyExcerpts: empty excerpt is trivially verified, untouched", () => {
  const claim = buildVerifiableClaim();
  const finding = buildComplianceFinding({
    policy_excerpt: "",
    confidence_score: 0.7,
    excerpt_verified: false,
  });

  const [result] = verifyPolicyExcerpts([finding], [claim], {});

  assertEquals(result.excerpt_verified, true);
  assertEquals(result.confidence_score, 0.7); // unchanged
});

Deno.test("verifyPolicyExcerpts: excerpt found verbatim (case-insensitive) in retrieved evidence -> verified", () => {
  const claim = buildVerifiableClaim({ category: "health_or_medical_claim" });
  const finding = buildComplianceFinding({
    policy_excerpt: "Must Be Substantiated",
    excerpt_verified: false,
  });
  const evidence: EvidenceByCategory = {
    health_or_medical_claim: [
      {
        chunk_id: "reg-1",
        source: "guidance",
        text: "claims must be substantiated by rigorous evidence.",
      },
    ],
  };

  const [result] = verifyPolicyExcerpts([finding], [claim], evidence);

  assertEquals(result.excerpt_verified, true);
  assertEquals(result.policy_excerpt, "Must Be Substantiated"); // preserved
});

Deno.test("verifyPolicyExcerpts: excerpt not found in evidence -> cleared and confidence capped", () => {
  const claim = buildVerifiableClaim({ category: "health_or_medical_claim" });
  const finding = buildComplianceFinding({
    policy_excerpt: "an invented citation",
    confidence_score: 0.9,
    excerpt_verified: false,
  });
  const evidence: EvidenceByCategory = {
    health_or_medical_claim: [
      {
        chunk_id: "reg-1",
        source: "guidance",
        text: "unrelated regulatory text.",
      },
    ],
  };

  const [result] = verifyPolicyExcerpts([finding], [claim], evidence);

  assertEquals(result.excerpt_verified, false);
  assertEquals(result.policy_excerpt, "");
  assertEquals(result.confidence_score, 0.3); // capped, not raised
});

Deno.test("verifyPolicyExcerpts: does not raise confidence that was already below the cap", () => {
  const claim = buildVerifiableClaim({ category: "health_or_medical_claim" });
  const finding = buildComplianceFinding({
    policy_excerpt: "an invented citation",
    confidence_score: 0.1,
    excerpt_verified: false,
  });

  const [result] = verifyPolicyExcerpts([finding], [claim], {});

  assertEquals(result.confidence_score, 0.1); // min(0.1, 0.3) = 0.1
});

Deno.test("verifyPolicyExcerpts: claim category with no retrieved evidence at all -> treated as unverified", () => {
  const claim = buildVerifiableClaim({ category: "pricing_or_offer_claim" });
  const finding = buildComplianceFinding({
    policy_excerpt: "some excerpt",
    excerpt_verified: false,
  });

  const [result] = verifyPolicyExcerpts([finding], [claim], {}); // no pricing evidence

  assertEquals(result.excerpt_verified, false);
  assertEquals(result.policy_excerpt, "");
});
