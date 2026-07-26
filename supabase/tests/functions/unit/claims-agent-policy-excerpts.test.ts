import { assertEquals } from "@std/assert";

import { verifyPolicyExcerpts } from "../../../functions/claims-agent/metrics.ts";
import type {
  ComplianceFinding,
  EvidenceByCategory,
  VerifiableClaim,
} from "../../../functions/claims-agent/types.ts";

Deno.test("claims-agent verifies policy excerpts against matching evidence", () => {
  const claims: VerifiableClaim[] = [
    {
      claim_id: "c1",
      text: "Clinically proven to reduce wrinkles in 7 days.",
      category: "health_or_medical_claim",
      instances: [
        {
          text: "This serum is clinically proven to reduce wrinkles in 7 days.",
          source: "transcript",
          start_ms: 8000,
          timestamp: "00:08",
        },
      ],
    },
  ];

  const findings: ComplianceFinding[] = [
    {
      claim_id: "c1",
      severity: 2,
      policy_excerpt: "Results may vary",
      issue_description: "Needs a disclaimer citation.",
      recommendation: "Keep the disclaimer visible.",
      confidence_score: 0.8,
      excerpt_verified: false,
    },
  ];

  const evidence: EvidenceByCategory = {
    health_or_medical_claim: [
      {
        chunk_id: "r1",
        source: "regulatory",
        text: "Results may vary. Consult a professional.",
      },
    ],
  };

  const verified = verifyPolicyExcerpts(findings, claims, evidence);

  assertEquals(verified[0].excerpt_verified, true);
  assertEquals(verified[0].policy_excerpt, "Results may vary");
  assertEquals(verified[0].confidence_score, 0.8);
});
