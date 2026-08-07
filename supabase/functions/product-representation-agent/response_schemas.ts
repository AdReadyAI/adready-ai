/** Runtime schemas for the Product Representation model response. */

import { z } from "zod";

import {
  ConfidenceLevelSchema,
  SeverityLevelSchema,
} from "../shared/schemas.ts";
import {
  ModelEvidenceSchema,
  parseModelResponse,
} from "../shared/modelResponse.ts";

export const ProductSubCheckIdSchema = z.enum([
  "product_not_shown",
  "product_obscured",
  "product_appearance_wrong",
  "product_name_unspoken",
]);
export type ProductSubCheckId = z.infer<typeof ProductSubCheckIdSchema>;

export const ProductSubCheckResponseSchema = z.object({
  check_id: ProductSubCheckIdSchema,
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: SeverityLevelSchema,
  explanation: z.string().nullish(),
});
export type ProductSubCheckResponse = z.infer<
  typeof ProductSubCheckResponseSchema
>;

export const ProductRepresentationResponseSchema = z.object({
  confidence: ConfidenceLevelSchema.nullish(),
  evidence: z.array(ModelEvidenceSchema).default([]),
  explanation: z.string().nullish(),
  suggested_correction: z.string().nullish(),
  correction_type: z.string().nullish(),
  sub_checks: z.array(ProductSubCheckResponseSchema).default([]),
});
export type ProductRepresentationResponse = z.infer<
  typeof ProductRepresentationResponseSchema
>;

/** Parse model output without allowing malformed data to cross the agent seam. */
export function parseProductRepresentationResponse(
  raw: string,
): ProductRepresentationResponse | null {
  return parseModelResponse(raw, ProductRepresentationResponseSchema);
}
