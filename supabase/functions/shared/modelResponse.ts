/** Shared normalization helpers for untrusted evaluator model responses. */

import { z } from "zod";

import {
  cannotAssess,
  evidence as evidenceRef,
  failed,
  passed,
} from "./checks.ts";
import { stripCodeFences } from "./llm.ts";
import {
  type AgentContext,
  type EvidenceRef,
  type MetricResult,
  type SeverityLevel,
  type SubCheckResult,
} from "./schemas.ts";

/** Model-facing evidence stays permissive until it reaches the shared contract. */
export const ModelEvidenceSchema = z.object({
  type: z.string(),
  source_id: z.string(),
  text: z.string(),
  timestamp: z.string().nullish(),
});
export type ModelEvidence = z.infer<typeof ModelEvidenceSchema>;

type ModelSubCheck = {
  result: "passed" | "failed" | "cannot_assess";
  severity: SeverityLevel;
  explanation?: string | null;
};

/** Extract a JSON object from a bare, fenced, or briefly prefixed model reply. */
export function extractJsonObject(raw: string): string | null {
  const body = stripCodeFences(raw);
  if (body.length === 0) return null;

  try {
    JSON.parse(body);
    return body;
  } catch {
    // Some providers still prepend prose even when the prompt requires JSON.
  }

  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
}

/** Parse and validate one model response without leaking malformed data. */
export function parseModelResponse<Schema extends z.ZodTypeAny>(
  raw: string,
  schema: Schema,
): z.output<Schema> | null {
  const json = extractJsonObject(raw);
  if (json === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Resolve model citations back to canonical, context-backed Media Evidence. */
export function resolveEvidenceRefs(
  context: AgentContext,
  citations: ModelEvidence[],
): EvidenceRef[] {
  return citations.flatMap((citation): EvidenceRef[] => {
    if (citation.type === "transcript") {
      const segment = context.transcript_segments.find((item) =>
        item.segment_id === citation.source_id
      );
      return segment
        ? [
          evidenceRef(
            "transcript",
            segment.text,
            segment.start_ms,
            segment.end_ms,
          ),
        ]
        : [];
    }

    if (citation.type === "ocr") {
      const segment = context.ocr_segments.find((item) =>
        item.ocr_id === citation.source_id
      );
      return segment
        ? [evidenceRef("ocr", segment.text, segment.start_ms, segment.end_ms)]
        : [];
    }

    if (citation.type === "visual") {
      const frame = context.visual_frames.find((item) =>
        item.frame_id === citation.source_id
      );
      if (!frame) return [];
      const description = [frame.action, frame.framing_composition]
        .filter(Boolean)
        .join(" ");
      return [evidenceRef("visual", description, frame.timestamp_ms)];
    }

    if (citation.type === "brief") {
      if (citation.source_id === "creative_brief") {
        return [evidenceRef("brief", context.parsed_creative_brief.raw_text)];
      }
      if (citation.source_id === "campaign_goal") {
        return [evidenceRef("brief", context.campaign_goal)];
      }
      return [];
    }

    if (
      citation.type === "product_page" &&
      citation.source_id === "product_context" &&
      context.product_context?.raw_text
    ) {
      return [evidenceRef("product_page", context.product_context.raw_text)];
    }

    if (
      citation.type === "metadata" && citation.source_id === "video_metadata"
    ) {
      return [
        evidenceRef("metadata", JSON.stringify(context.video_metadata)),
      ];
    }

    // Unknown types and fabricated identifiers never cross the persistence seam.
    return [];
  });
}

/** Coerce a model-authored correction type into the shared output contract. */
export function toCorrectionType(
  value: string | null | undefined,
): MetricResult["correction_type"] {
  const allowed = new Set<MetricResult["correction_type"]>([
    "rewrite",
    "edit_recommendation",
    "technical_fix",
    "none",
  ]);
  return allowed.has(value as MetricResult["correction_type"])
    ? (value as MetricResult["correction_type"])
    : "edit_recommendation";
}

/** Normalize one model judgment through the shared sub-check constructors. */
export function normalizeModelSubCheck(
  response: ModelSubCheck | undefined,
  checkId: string,
  name: string,
  missingReason: string,
  insufficientReason: string,
  failedReason: string,
): SubCheckResult {
  if (response === undefined) {
    return cannotAssess(checkId, name, missingReason);
  }
  if (response.result === "passed") return passed(checkId, name);
  if (response.result === "cannot_assess") {
    return cannotAssess(
      checkId,
      name,
      response.explanation ?? insufficientReason,
    );
  }

  if (
    response.severity === "none" || response.severity === "cannot_assess"
  ) {
    return cannotAssess(
      checkId,
      name,
      `The model returned an invalid failed/${response.severity} result: ${
        response.explanation ?? "No explanation was supplied."
      }`,
    );
  }

  return failed(
    checkId,
    name,
    response.severity,
    response.explanation ?? failedReason,
  );
}
