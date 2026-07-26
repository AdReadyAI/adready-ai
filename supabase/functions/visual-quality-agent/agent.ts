import { MetricResultSchema } from "../shared/schemas.ts";
import type { MetricResult } from "../shared/schemas.ts";

import { evaluateProductionReadiness } from "./metrics.ts";
import type { ProductionReadinessChecks, VisualAuditFinding } from "./types.ts";

import { getAgentContext } from "./tools/context.ts";
import { checkMetadata } from "./tools/metadata-check.ts";
import { checkOCR } from "./tools/ocr-check.ts";
import { auditVisualQuality } from "./tools/visual-audit.ts";
import { msToTimestamp } from "./utils.ts";

export type VisualQualityDependencies = {
  getAgentContext: typeof getAgentContext;
  checkMetadata: typeof checkMetadata;
  checkOCR: typeof checkOCR;
  auditVisualQuality: typeof auditVisualQuality;
  evaluateProductionReadiness: typeof evaluateProductionReadiness;
};

export const visualQualityDependencies: VisualQualityDependencies = {
  getAgentContext,
  checkMetadata,
  checkOCR,
  auditVisualQuality,
  evaluateProductionReadiness,
};

export async function runVisualQualityAgent(
  requestId: string,
  deps: VisualQualityDependencies = visualQualityDependencies,
): Promise<MetricResult[]> {
  // Stage 1: Load DB-shaped context.
  // Currently backed by mock data.
  const context = await deps.getAgentContext(requestId);

  // Stage 2: Deterministic metadata checks.
  const metadataChecks = deps.checkMetadata(context);

  // Stage 3: OCR/text quality checks.
  const ocrChecks = deps.checkOCR(context);

  // Stage 4: LLM-assisted visual audit.
  const visualFindings = await deps.auditVisualQuality(context);

  // Stage 5: Merge all findings into the six production-readiness checks.
  const checks: ProductionReadinessChecks = {
    ...metadataChecks,
    ...ocrChecks,
    ...buildVisualChecks(visualFindings),
  };

  // Stage 6: Deterministic synthesis into public MetricResult.
  const result = deps.evaluateProductionReadiness(context, checks);

  return MetricResultSchema.array().parse([result]);
}

function buildVisualChecks(
  findings: VisualAuditFinding[],
): Pick<
  ProductionReadinessChecks,
  "ai_artifacts" | "poor_framing_lighting" | "jarring_transitions"
> {
  const checkIds = [
    "ai_artifacts",
    "poor_framing_lighting",
    "jarring_transitions",
  ] as const;

  return Object.fromEntries(
    checkIds.map((checkId) => {
      const finding = findings.find(
        (item) => item.check_id === checkId,
      );

      if (!finding) {
        return [
          checkId,
          {
            check_id: checkId,
            name: getCheckName(checkId),
            result: "cannot_assess",
            severityScore: 0,
            explanation:
              "The visual audit did not return a finding for this check.",
            evidence: undefined,
            confidence_score: 0,
          },
        ];
      }

      const hasEvidence = finding.evidence_text.trim().length > 0;

      return [
        checkId,
        {
          check_id: checkId,
          name: getCheckName(checkId),
          result: finding.severity === 0 ? "passed" : "failed",
          severityScore: finding.severity,
          explanation: finding.explanation,
          evidence: hasEvidence
            ? {
              type: "visual" as const,
              text: finding.evidence_text,
              timestamp: finding.evidence_timestamp_ms === null
                ? ""
                : msToTimestamp(
                  finding.evidence_timestamp_ms,
                ),
            }
            : undefined,
          confidence_score: finding.confidence_score,
        },
      ];
    }),
  ) as Pick<
    ProductionReadinessChecks,
    "ai_artifacts" | "poor_framing_lighting" | "jarring_transitions"
  >;
}

function getCheckName(
  checkId:
    | "ai_artifacts"
    | "poor_framing_lighting"
    | "jarring_transitions",
): string {
  const names = {
    ai_artifacts: "AI Artifacts Audit",
    poor_framing_lighting: "Framing and Lighting Check",
    jarring_transitions: "Transition Continuity Check",
  };

  return names[checkId];
}
