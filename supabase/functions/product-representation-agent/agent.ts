/**
 * agent.ts — Orchestration for the Product Representation Agent: the
 * deterministic screen-time coverage check, the OpenRouter tool-forced call
 * for the remaining sub-checks, and guardrails on the merged result.
 */

import type {
  ConfidenceLevel,
  EvidenceBundle,
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";
import { SONNET } from "../shared/claude.ts";
import {
  buildToolSchema,
  CONFIDENCE_LEVELS,
  CORRECTION_TYPES,
  EVIDENCE_TYPES,
  LLM_SUB_CHECK_IDS,
  METRIC_ID,
  METRIC_NAME,
  METRIC_QUESTION,
  RESULT_VALUES,
  SEVERITY_LEVELS,
  type SubCheckId,
  SUB_CHECK_NAMES,
  SUB_CHECK_RESULT_VALUES,
  TOOL_NAME,
} from "./metrics.ts";
import { buildUserContent } from "./evidence.ts";

export type ChatClient = {
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<{
        choices: Array<{
          message: {
            tool_calls?: Array<{
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      }>;
    };
  };
};

const SYSTEM_PROMPT =
  `You are the Product Representation agent in an ad-review pipeline. You ` +
  `grade whether the advertised product is clearly represented, using only ` +
  `the product-moment scene descriptions, transcript, and on-screen text ` +
  `you are given — you never see the raw video or keyframe images. ` +
  `product_appearance_wrong can only be judged from on-screen text (OCR) ` +
  `compared against the brief's product/packaging description; return ` +
  `cannot_assess for it if there is no relevant OCR text, do not guess from ` +
  `scene descriptions alone. Grade severity (none, low, medium, high, ` +
  `critical), cite specific evidence, and self-report confidence (low, ` +
  `medium, high) — if you cannot cite specific evidence, confidence must be ` +
  `low. Call the ${TOOL_NAME} tool with your findings; do not respond with ` +
  `plain text, and do not include an insufficient_visibility sub-check — ` +
  `that one is computed separately.`;

export const APPEARANCE_DEADLINE_MS = 3000;
export const MIN_COVERAGE_RATIO = 0.15;

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
  cannot_assess: -1,
};

function worseSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

export function computeInsufficientVisibilitySubCheck(
  bundle: EvidenceBundle,
): SubCheckResult {
  const duration = bundle.video_metadata.duration_ms;
  const name = SUB_CHECK_NAMES.insufficient_visibility;

  if (!bundle.product_moments.length || !duration) {
    return {
      check_id: "insufficient_visibility",
      name,
      result: "cannot_assess",
      severity: "cannot_assess",
      explanation:
        "No product moments or video duration to compute screen-time coverage from.",
    };
  }

  const firstAppearanceMs = Math.min(
    ...bundle.product_moments.map((m) => m.start_ms),
  );
  const coveredMs = bundle.product_moments.reduce(
    (sum, m) => sum + Math.max(0, m.end_ms - m.start_ms),
    0,
  );
  const coverageRatio = coveredMs / duration;

  const late = firstAppearanceMs > APPEARANCE_DEADLINE_MS;
  const thin = coverageRatio < MIN_COVERAGE_RATIO;

  if (!late && !thin) {
    return {
      check_id: "insufficient_visibility",
      name,
      result: "passed",
      severity: "none",
    };
  }

  const severity: SeverityLevel = late && thin ? "high" : "medium";
  const reasons = [
    late
      ? `first appears at ${firstAppearanceMs}ms (after the ${APPEARANCE_DEADLINE_MS}ms deadline)`
      : "",
    thin
      ? `covers only ${(coverageRatio * 100).toFixed(1)}% of runtime (below ${
        (MIN_COVERAGE_RATIO * 100).toFixed(0)
      }%)`
      : "",
  ].filter(Boolean).join(" and ");

  return {
    check_id: "insufficient_visibility",
    name,
    result: "failed",
    severity,
    explanation: `Product ${reasons}.`,
  };
}

type RawFinding = {
  result?: unknown;
  severity?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  explanation?: unknown;
  suggested_correction?: unknown;
  correction_type?: unknown;
  sub_checks?: unknown;
};

function sanitizeEvidence(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(EVIDENCE_TYPES);
  const out: EvidenceRef[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.type !== "string" || !allowed.has(rec.type)) continue;
    if (typeof rec.text !== "string") continue;
    out.push({
      type: rec.type as EvidenceRef["type"],
      text: rec.text,
      timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "",
    });
  }
  return out;
}

function sanitizeSubChecks(raw: unknown): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(LLM_SUB_CHECK_IDS);
  const validResults = new Set<string>(SUB_CHECK_RESULT_VALUES);
  const validSeverities = new Set<string>(SEVERITY_LEVELS);
  const out: SubCheckResult[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    if (typeof rec.check_id !== "string" || !allowed.has(rec.check_id)) {
      continue;
    }
    if (typeof rec.result !== "string" || !validResults.has(rec.result)) {
      continue;
    }
    if (
      typeof rec.severity !== "string" || !validSeverities.has(rec.severity)
    ) continue;
    out.push({
      check_id: rec.check_id,
      name: SUB_CHECK_NAMES[rec.check_id as SubCheckId] ?? rec.check_id,
      result: rec.result as SubCheckResult["result"],
      severity: rec.severity as SeverityLevel,
      explanation: typeof rec.explanation === "string"
        ? rec.explanation
        : undefined,
    });
  }
  return out;
}

function buildLlmMetricResult(raw: RawFinding | undefined): MetricResult {
  const result =
    typeof raw?.result === "string" &&
      (RESULT_VALUES as readonly string[]).includes(raw.result)
      ? (raw.result as MetricResult["result"])
      : "cannot_assess";
  const severity =
    typeof raw?.severity === "string" &&
      (SEVERITY_LEVELS as readonly string[]).includes(raw.severity)
      ? (raw.severity as SeverityLevel)
      : "cannot_assess";
  let confidence: ConfidenceLevel | undefined =
    typeof raw?.confidence === "string" &&
      (CONFIDENCE_LEVELS as readonly string[]).includes(raw.confidence)
      ? (raw.confidence as ConfidenceLevel)
      : undefined;

  const evidence = sanitizeEvidence(raw?.evidence);
  if (evidence.length === 0) {
    confidence = "low";
  }

  const correctionType =
    typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
      ? (raw.correction_type as MetricResult["correction_type"])
      : "none";

  return {
    metric_id: METRIC_ID,
    agent: "product_representation",
    metric_name: METRIC_NAME,
    question: METRIC_QUESTION,
    result,
    severity,
    confidence,
    evidence,
    explanation: typeof raw?.explanation === "string"
      ? raw.explanation
      : undefined,
    suggested_correction: typeof raw?.suggested_correction === "string"
      ? raw.suggested_correction
      : undefined,
    correction_type: correctionType,
    sub_checks: sanitizeSubChecks(raw?.sub_checks),
  };
}

export async function runProductRepresentationAgent(
  bundle: EvidenceBundle,
  client: ChatClient,
): Promise<MetricResult[]> {
  const response = await client.chat.completions.create({
    model: SONNET,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserContent(bundle) },
    ],
    tools: [buildToolSchema()],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== TOOL_NAME) {
    throw new Error("model did not return the expected tool call");
  }

  let raw: RawFinding;
  try {
    raw = JSON.parse(toolCall.function.arguments) as RawFinding;
  } catch {
    throw new Error("model returned invalid JSON in tool call arguments");
  }

  const llmResult = buildLlmMetricResult(raw);
  const visibilityCheck = computeInsufficientVisibilitySubCheck(bundle);

  const finalSeverity = worseSeverity(llmResult.severity, visibilityCheck.severity);
  const finalResult: MetricResult["result"] = visibilityCheck.result === "failed"
    ? "false"
    : llmResult.result;

  return [
    {
      ...llmResult,
      result: finalResult,
      severity: finalSeverity,
      sub_checks: [...(llmResult.sub_checks ?? []), visibilityCheck],
    },
  ];
}
