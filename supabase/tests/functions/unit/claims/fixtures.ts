/**
 * fixtures.ts — Shared test fixtures for the claims-agent test suite.
 * Builders take an `overrides` object so each test only specifies the
 * fields it actually cares about.
 */

import type {
  DerivedClaim,
  SubstantiationFinding,
  TriageResult,
  VerifiableClaim,
} from "../../../../functions/claims-agent/checks.ts";
import type { AdWidePolicyAssessment } from "../../../../functions/claims-agent/policy.ts";
import type {
  OCRSegment,
  ParsedCreativeBrief,
  TranscriptSegment,
} from "../../../../functions/shared/index.ts";

// ---------------------------------------------------------------------------
// Raw segments (checks.test.ts: extraction resolves segment_ids against these)
// ---------------------------------------------------------------------------

export const TRANSCRIPT: TranscriptSegment[] = [
  {
    segment_id: "t1",
    start_ms: 2000,
    end_ms: 5000,
    text: "Real tropical mango.",
  },
  {
    segment_id: "t2",
    start_ms: 8000,
    end_ms: 10000,
    text: "Ice cold, endlessly refreshing.",
  },
];

export const OCR: OCRSegment[] = [
  {
    ocr_id: "o1",
    frame_ids: ["f1"],
    start_ms: 4000,
    end_ms: 6000,
    text: "Contains caffeine",
    on_screen_duration_ms: 2000,
  },
];

/** An OCR segment matched by evaluatePolicyCompliance's disclaimer resolution. */
export function buildDisclaimerOcrSegment(
  overrides: Partial<OCRSegment> = {},
): OCRSegment {
  return {
    ocr_id: "o-disclaimer",
    frame_ids: ["f1"],
    start_ms: 1000,
    end_ms: 3000,
    text: "Disclaimer: results may vary.",
    on_screen_duration_ms: 2000,
    font_size_px: 16,
    ...overrides,
  };
}

/** A transcript segment matched by evaluatePolicyCompliance's disclaimer resolution. */
export function buildDisclaimerTranscriptSegment(
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    segment_id: "t-disclaimer",
    start_ms: 1000,
    end_ms: 3000,
    text: "Disclaimer: results may vary.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const DEFAULT_INSTANCE = {
  text: "Real tropical mango.",
  source: "transcript" as const,
  start_ms: 2000,
  timestamp: "00:02",
};

export function buildClaim(
  overrides: Partial<DerivedClaim> = {},
): DerivedClaim {
  return {
    claim_id: "claim-1",
    text: "Real tropical mango",
    instances: [DEFAULT_INSTANCE],
    ...overrides,
  };
}

export function buildVerifiableClaim(
  overrides: Partial<VerifiableClaim> = {},
): VerifiableClaim {
  return {
    ...buildClaim(),
    category: "factual_claim",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export function buildTriage(
  overrides: Partial<TriageResult> = {},
): TriageResult {
  return {
    claim_id: "claim-1",
    is_verifiable_claim: true,
    category: "factual_claim",
    reasoning: "r",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function buildSubstantiationFinding(
  overrides: Partial<SubstantiationFinding> = {},
): SubstantiationFinding {
  return {
    claim_id: "claim-1",
    classification: "none",
    severity: 0,
    issue_description: "supported",
    recommendation: "",
    product_page_evidence: "",
    confidence_score: 0.9,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Ad-wide policy assessment
// ---------------------------------------------------------------------------

export function buildAdWidePolicyAssessment(
  overrides: {
    disclaimer?: Partial<AdWidePolicyAssessment["disclaimer"]>;
    policy_depiction?: Partial<AdWidePolicyAssessment["policy_depiction"]>;
  } = {},
): AdWidePolicyAssessment {
  return {
    disclaimer: {
      required: false,
      present: true,
      matched_segment_id: null,
      matched_source: null,
      explanation: "",
      confidence_score: 0.9,
      ...overrides.disclaimer,
    },
    policy_depiction: {
      detected: false,
      severity: 0,
      description: "",
      matched_segment_id: null,
      matched_source: null,
      confidence_score: 0.9,
      ...overrides.policy_depiction,
    },
  };
}

// ---------------------------------------------------------------------------
// Creative brief
// ---------------------------------------------------------------------------

export const BASE_BRIEF: ParsedCreativeBrief = {
  raw_text: "",
  required_messages: [],
  required_ctas: [],
  approved_claims: [],
  forbidden_claims: [],
  brand_guidelines: [],
  policy_requirements: [],
};

/** A ClaimInstance with identical content, for evidence-dedup tests -- two
 * different claims can legitimately cite the exact same underlying segment. */
export const SHARED_INSTANCE = DEFAULT_INSTANCE;
