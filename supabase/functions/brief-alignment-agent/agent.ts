/**
 * agent.ts — Orchestration for the Brief Alignment Agent: prompt assembly,
 * the OpenRouter tool-forced call, and guardrails on the returned findings.
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
  ALL_SUB_CHECK_IDS,
  buildToolSchema,
  CONFIDENCE_LEVELS,
  CORRECTION_TYPES,
  EVIDENCE_TYPES,
  type MetricConfig,
  METRIC_CONFIGS,
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
  `You are the Brief Alignment agent in an ad-review pipeline. You grade a ` +
  `video ad against its creative brief using only the transcript, on-screen ` +
  `text, and scene descriptions you are given. You never see the raw video. ` +
  `For each metric, decide status, grade severity (none, low, medium, high, ` +
  `critical), cite specific evidence (a transcript span, an OCR line, or a ` +
  `scene description), and self-report confidence (low, medium, high). If ` +
  `you cannot cite specific evidence for a finding, your confidence for it ` +
  `must be low. Use cannot_assess when the brief gives nothing to check a ` +
  `metric against. Call the ${TOOL_NAME} tool with your findings for every ` +
  `metric listed; do not respond with plain text.`;

type RawFinding = {
  metric_id?: unknown;
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

function sanitizeSubChecks(
  raw: unknown,
  allowedIds: readonly SubCheckId[],
): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(allowedIds);
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

function buildMetricResult(
  config: MetricConfig,
  raw: RawFinding | undefined,
): MetricResult {
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

  const subChecks = sanitizeSubChecks(raw?.sub_checks, config.sub_check_ids);

  const correctionType =
    typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
      ? (raw.correction_type as MetricResult["correction_type"])
      : "none";

  return {
    metric_id: config.metric_id,
    agent: "brief_alignment",
    metric_name: config.metric_name,
    question: config.question,
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
    sub_checks: subChecks,
  };
}

export async function runBriefAlignmentAgent(
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

  let parsed: { findings?: unknown };
  try {
    parsed = JSON.parse(toolCall.function.arguments) as { findings?: unknown };
  } catch {
    throw new Error("model returned invalid JSON in tool call arguments");
  }

  const findings = Array.isArray(parsed.findings)
    ? (parsed.findings as RawFinding[])
    : [];
  const byMetricId = new Map<string, RawFinding>();
  for (const f of findings) {
    if (typeof f.metric_id === "string") byMetricId.set(f.metric_id, f);
  }

  return METRIC_CONFIGS.map((config) =>
    buildMetricResult(config, byMetricId.get(config.metric_id))
  );
}
