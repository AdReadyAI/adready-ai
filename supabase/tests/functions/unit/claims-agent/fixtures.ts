import type {
  DerivedClaim,
  VerifiableClaim,
} from "../../../../functions/claims-agent/types.ts";

export function baseClaims(): DerivedClaim[] {
  return [
    {
      claim_id: "c1",
      text: "Clinically proven to reduce wrinkles in 7 days.",
      instances: [
        {
          text: "This serum is clinically proven to reduce wrinkles in 7 days.",
          source: "transcript",
          start_ms: 8000,
          timestamp: "00:08",
        },
        {
          text: "Clinically proven to reduce wrinkles",
          source: "ocr",
          start_ms: 20000,
          timestamp: "00:20",
        },
      ],
    },
    {
      claim_id: "c2",
      text: "Formulated with dermatologist-recommended ingredients.",
      instances: [
        {
          text: "Formulated with dermatologist-recommended ingredients.",
          source: "transcript",
          start_ms: 15000,
          timestamp: "00:15",
        },
      ],
    },
  ];
}

export function baseClaimsAsVerifiable(): VerifiableClaim[] {
  return [
    { ...baseClaims()[0], category: "health_or_medical_claim" },
    { ...baseClaims()[1], category: "factual_claim" },
  ];
}
