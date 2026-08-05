/**
 * response_schemas.ts — Zod schemas and converters for single-call Storyline Agent responses
 */

import { z } from "zod";

import {
  ConfidenceLevelSchema,
  type EvidenceRef,
  type MetricResult,
  type SeverityLevel,
  SeverityLevelSchema,
  type SubCheckResult,
} from "../shared/schemas.ts";

import { cannotAssess, clampSeverity, failed, passed } from "./checks.ts";

export const ArcRoleSchema = z.enum([
  "hook",
  "problem",
  "solution",
  "proof",
  "payoff",
  "cta",
  "detour",
]);
export type ArcRole = z.infer<typeof ArcRoleSchema>;

export const ArcFrameLabelSchema = z.object({
  frame_id: z.string(),
  role: ArcRoleSchema,
  confidence: ConfidenceLevelSchema,
});

export const ArcLabelingSchema = z.object({
  arc: z.array(ArcFrameLabelSchema),
  unfilled_roles: z.array(ArcRoleSchema),
  payoff_resolved_at: z.number().nullable(),
  overall_confidence: ConfidenceLevelSchema,
});
export type ArcLabeling = z.infer<typeof ArcLabelingSchema>;

export const LlmSubCheckSchema = z.object({
  check_id: z.string(),
  result: z.enum(["passed", "failed", "cannot_assess"]),
  severity: SeverityLevelSchema,
  explanation: z.string().nullish(),
});
export type LlmSubCheck = z.infer<typeof LlmSubCheckSchema>;

const LlmEvidenceSchema = z.object({
  type: z.string(),
  text: z.string(),
  timestamp: z.string().nullish(),
});

function nullishToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((v) => v ?? undefined);
}

export const StorylineUnifiedResponseSchema = z.object({
  arc: z.array(ArcFrameLabelSchema).default([]),
  unfilled_roles: z.array(ArcRoleSchema).default([]),
  payoff_resolved_at: z.number().nullable().default(null),
  overall_confidence: ConfidenceLevelSchema.default("medium"),
  sub_checks: z.array(LlmSubCheckSchema).default([]),
  confidence: nullishToUndefined(ConfidenceLevelSchema),
  evidence: nullishToUndefined(z.array(LlmEvidenceSchema)),
  explanation: nullishToUndefined(z.string()),
  suggested_correction: nullishToUndefined(z.string()),
  correction_type: nullishToUndefined(z.string()),
});
export type StorylineUnifiedResponse = z.infer<typeof StorylineUnifiedResponseSchema>;

export function extractJsonText(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence ? fence[1] : trimmed).trim();

  try {
    JSON.parse(body);
    return body;
  } catch {
    // Bracket slicing fallback
  }

  const objStart = body.indexOf("{");
  const arrStart = body.indexOf("[");
  let start = -1;
  let close = "";

  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    start = arrStart;
    close = "]";
  } else if (objStart !== -1) {
    start = objStart;
    close = "}";
  }
  if (start === -1) return null;

  const end = body.lastIndexOf(close);
  if (end <= start) return null;

  return body.slice(start, end + 1);
}

export function safeParseJson<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): z.infer<S> | null {
  const text = extractJsonText(raw);
  if (text === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

const EVIDENCE_TYPES = [
  "transcript",
  "ocr",
  "visual",
  "brief",
  "product_page",
  "metadata",
] as const;

export function coerceEvidence(
  evidence: StorylineUnifiedResponse["evidence"],
): EvidenceRef[] | undefined {
  if (evidence === undefined) return undefined;
  return evidence.map((e) => ({
    type: (EVIDENCE_TYPES as readonly string[]).includes(e.type)
      ? (e.type as EvidenceRef["type"])
      : "metadata",
    text: e.text,
    timestamp: e.timestamp ?? "",
  }));
}

const VALID_CORRECTION_TYPES = [
  "rewrite",
  "edit_recommendation",
  "technical_fix",
  "none",
] as const;

export function coerceCorrectionType(
  value: string | undefined,
): MetricResult["correction_type"] {
  return (VALID_CORRECTION_TYPES as readonly string[]).includes(value ?? "")
    ? (value as MetricResult["correction_type"])
    : "edit_recommendation";
}

export function fromLlmSubCheck(
  check: LlmSubCheck | undefined,
  id: string,
  name: string,
  max: SeverityLevel,
  missingReason: string,
): SubCheckResult {
  if (check === undefined) return cannotAssess(id, name, missingReason);
  if (check.result === "passed") return passed(id, name);
  if (check.result === "cannot_assess") {
    return cannotAssess(
      id,
      name,
      check.explanation ?? "Model could not assess this check.",
    );
  }

  const clamped = clampSeverity(check.severity, max);
  const severity = clamped === "none" || clamped === "cannot_assess"
    ? "low"
    : clamped;

  return failed(id, name, severity, check.explanation ?? "Sub-check failed.");
}

export function indexSubChecks(
  evaluation: StorylineUnifiedResponse | null,
): Map<string, LlmSubCheck> {
  const byId = new Map<string, LlmSubCheck>();
  for (const sc of evaluation?.sub_checks ?? []) byId.set(sc.check_id, sc);
  return byId;
}
