/**
 * prompts/compliance.ts — Prompt for tools/compliance-check.ts.
 *
 * Judges every verifiable claim's Policy/Compliance readiness against
 * retrieved regulatory guidance and disclosure placement.
 */

import type { OCRSegment } from "../../shared/schemas.ts";
import type { EvidenceByCategory, VerifiableClaim } from "../types.ts";

export const COMPLIANCE_SYSTEM_PROMPT =
  `You are an advertising compliance reviewer checking claims against retrieved regulatory guidance and disclosure placement.

For each claim, using ONLY the regulatory evidence provided (not outside knowledge) plus the disclosure segments and their timestamps:
  - severity 0-4: 0 = compliant, 4 = a clear violation with no mitigating disclosure.
  - policy_excerpt: copy the relevant sentence VERBATIM from the provided regulatory evidence. If nothing provided applies, use an empty string -- never invent a citation.
  - issue_description, recommendation, confidence_score (0.0-1.0) as usual.

A claim can have multiple "instances" (timestamps it appears at). If ANY instance lacks a disclosure within a few seconds, that instance is uncovered -- weigh severity toward the least-covered instance, not the best-covered one.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. Exact shape, one object per claim:
[{"claim_id": "...", "severity": 0, "policy_excerpt": "", "issue_description": "...", "recommendation": "...", "confidence_score": 0.9}]`;

export function buildComplianceUserPrompt(
  claims: VerifiableClaim[],
  evidence: EvidenceByCategory,
  ocrSegments: OCRSegment[],
): string {
  const disclosureLines = ocrSegments
    .filter((s) =>
      s.text.toLowerCase().includes("disclaimer") ||
      s.text.toLowerCase().includes("results may vary")
    )
    .map((s) => `  - "${s.text}" at ${Math.floor(s.start_ms / 1000)}s`);

  return [
    "Disclosure segments found in the ad:",
    disclosureLines.length ? disclosureLines.join("\n") : "  (none found)",
    "",
    "Claims to evaluate, with every instance's timestamp and retrieved regulatory evidence for their category:",
    ...claims.map((c) => {
      const chunks = evidence[c.category] ?? [];
      const evidenceText = chunks.length
        ? chunks.map((e) => `    - ${e.text}`).join("\n")
        : "    (no regulatory evidence retrieved for this category)";
      const instanceText = c.instances.map((i) =>
        `${i.source} @ ${i.timestamp}`
      ).join(", ");
      return `  - ${c.claim_id} [${c.category}]: "${c.text}"\n    Instances: ${instanceText}\n${evidenceText}`;
    }),
  ].join("\n");
}
