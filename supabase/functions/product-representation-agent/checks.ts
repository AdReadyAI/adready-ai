/** Agent-local Product Representation guards and metric roll-up. */

import { cannotAssess, rollupChecks } from "../shared/checks.ts";
import {
  normalizeModelSubCheck,
  resolveEvidenceRefs,
  toCorrectionType,
} from "../shared/modelResponse.ts";
import type {
  AgentContext,
  ConfidenceLevel,
  MetricResult,
  SubCheckResult,
} from "../shared/schemas.ts";

import type {
  ProductRepresentationResponse,
  ProductSubCheckId,
  ProductSubCheckResponse,
} from "./response_schemas.ts";

const CHECKS: Array<{ id: ProductSubCheckId; name: string }> = [
  { id: "product_not_shown", name: "Product Presence" },
  { id: "product_obscured", name: "Product Visibility" },
  { id: "product_appearance_wrong", name: "Product Appearance" },
  { id: "product_name_unspoken", name: "Product Name Presence" },
];

function hasProductAppearanceReference(context: AgentContext): boolean {
  // Logo matching belongs to Brand Alignment and cannot establish whether the
  // product unit or packaging matches its Product Reference.
  return Boolean(context.product_context?.raw_text?.trim());
}

function missingInputReason(
  context: AgentContext,
  checkId: ProductSubCheckId,
): string | null {
  if (
    checkId === "product_not_shown" &&
    context.product_frames.length === 0 &&
    context.visual_frames.length === 0
  ) {
    return "No product detections or visual frames are available to assess product presence.";
  }

  if (
    checkId === "product_obscured" && context.product_frames.length === 0
  ) {
    return "No product detections are available to assess focus, framing, or prominence.";
  }

  if (
    checkId === "product_appearance_wrong" &&
    !hasProductAppearanceReference(context)
  ) {
    return "No usable Product Reference or reference-derived match signal is available.";
  }

  if (
    checkId === "product_name_unspoken" &&
    context.transcript_segments.length === 0 &&
    context.ocr_segments.length === 0
  ) {
    return "No transcript or OCR evidence is available to assess product naming.";
  }

  return null;
}

/** Build the normalized set of four Product Representation sub-checks. */
function buildSubChecks(
  context: AgentContext,
  response: ProductRepresentationResponse | null,
): SubCheckResult[] {
  const byId = new Map<ProductSubCheckId, ProductSubCheckResponse>();
  for (const check of response?.sub_checks ?? []) {
    if (!byId.has(check.check_id)) byId.set(check.check_id, check);
  }

  return CHECKS.map(({ id, name }) => {
    const inputReason = missingInputReason(context, id);
    if (inputReason !== null) return cannotAssess(id, name, inputReason);

    return normalizeModelSubCheck(
      byId.get(id),
      id,
      name,
      `The model response omitted the required ${id} judgment.`,
      "The supplied Media Evidence was insufficient.",
      "The supplied evidence indicates this product check failed.",
    );
  });
}

function metricConfidence(
  response: ProductRepresentationResponse | null,
  hasEvidence: boolean,
): ConfidenceLevel {
  if (!hasEvidence) return "low";
  return response?.confidence ?? "low";
}

/** Assemble the normalized `product_clarity` metric. */
export function buildProductRepresentationResults(
  context: AgentContext,
  response: ProductRepresentationResponse | null,
): MetricResult[] {
  const subChecks = buildSubChecks(context, response);
  const rollup = rollupChecks(subChecks);
  const evidence = resolveEvidenceRefs(context, response?.evidence ?? []);
  const isFailure = rollup.result === "false";

  return [{
    metric_id: "product_clarity",
    agent: "product_representation",
    metric_name: "Product Clarity",
    question: "Can a viewer clearly identify the product being advertised?",
    result: rollup.result,
    severity: rollup.severity,
    confidence: metricConfidence(response, evidence.length > 0),
    evidence,
    explanation: response?.explanation ?? undefined,
    suggested_correction: isFailure
      ? response?.suggested_correction ?? undefined
      : undefined,
    correction_type: isFailure
      ? toCorrectionType(response?.correction_type)
      : "none",
    sub_checks: subChecks,
  }];
}
