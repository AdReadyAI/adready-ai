import { ALL_METRIC_IDS } from "./config.ts";
import type {
  Confidence,
  MetricId,
  MetricInput,
  MetricResultValue,
  Severity,
} from "./types.ts";

const RESULTS = new Set<MetricResultValue>([
  "true",
  "false",
  "cannot_assess",
]);

const SEVERITIES = new Set<Severity>([
  "none",
  "low",
  "medium",
  "high",
  "critical",
]);

const CONFIDENCES = new Set<Confidence>(["high", "medium", "low"]);

const METRIC_IDS = new Set<string>(ALL_METRIC_IDS);
const EXPECTED_METRIC_COUNT = ALL_METRIC_IDS.length;

export interface ParseRequestSuccess {
  ok: true;
  metric_results: MetricInput[];
}

export interface ParseRequestFailure {
  ok: false;
  error: string;
}

export type ParseRequestResult = ParseRequestSuccess | ParseRequestFailure;

/**
 * Validate the thin Edge Function body: `{ "metric_results": MetricInput[] }`.
 * Requires exactly the nine v0.3 metric_ids, each once.
 * Scoring rules stay in scoreEngine — this only checks shape/enums.
 */
export function parseScoreEngineRequest(body: unknown): ParseRequestResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const metricResults = (body as { metric_results?: unknown }).metric_results;
  if (!Array.isArray(metricResults)) {
    return {
      ok: false,
      error: 'Missing or invalid "metric_results" array',
    };
  }

  if (metricResults.length !== EXPECTED_METRIC_COUNT) {
    return {
      ok: false,
      error:
        `"metric_results" must contain exactly ${EXPECTED_METRIC_COUNT} items`,
    };
  }

  const parsed: MetricInput[] = [];
  const seen = new Set<MetricId>();

  for (let i = 0; i < metricResults.length; i++) {
    const row = metricResults[i];
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: `metric_results[${i}] must be an object` };
    }

    const metricId = (row as { metric_id?: unknown }).metric_id;
    const result = (row as { result?: unknown }).result;
    const severity = (row as { severity?: unknown }).severity;

    if (typeof metricId !== "string" || !METRIC_IDS.has(metricId)) {
      return {
        ok: false,
        error: `metric_results[${i}].metric_id is invalid`,
      };
    }

    const id = metricId as MetricId;
    if (seen.has(id)) {
      return {
        ok: false,
        error: `Duplicate metric_id "${id}" in metric_results`,
      };
    }
    seen.add(id);

    if (
      typeof result !== "string" || !RESULTS.has(result as MetricResultValue)
    ) {
      return {
        ok: false,
        error: `metric_results[${i}].result must be true|false|cannot_assess`,
      };
    }
    if (typeof severity !== "string" || !SEVERITIES.has(severity as Severity)) {
      return {
        ok: false,
        error:
          `metric_results[${i}].severity must be none|low|medium|high|critical`,
      };
    }

    const input: MetricInput = {
      metric_id: id,
      result: result as MetricResultValue,
      severity: severity as Severity,
    };

    const confidence = (row as { confidence?: unknown }).confidence;
    if (confidence !== undefined) {
      if (
        typeof confidence !== "string" ||
        !CONFIDENCES.has(confidence as Confidence)
      ) {
        return {
          ok: false,
          error: `metric_results[${i}].confidence must be high|medium|low`,
        };
      }
      input.confidence = confidence as Confidence;
    }

    const explanation = (row as { explanation?: unknown }).explanation;
    if (explanation !== undefined) {
      if (typeof explanation !== "string") {
        return {
          ok: false,
          error: `metric_results[${i}].explanation must be a string`,
        };
      }
      input.explanation = explanation;
    }

    const recommendedFix =
      (row as { recommended_fix?: unknown }).recommended_fix;
    if (recommendedFix !== undefined) {
      if (typeof recommendedFix !== "string") {
        return {
          ok: false,
          error: `metric_results[${i}].recommended_fix must be a string`,
        };
      }
      input.recommended_fix = recommendedFix;
    }

    const owner = (row as { owner?: unknown }).owner;
    if (owner !== undefined) {
      if (typeof owner !== "string") {
        return {
          ok: false,
          error: `metric_results[${i}].owner must be a string`,
        };
      }
      input.owner = owner;
    }

    const videoTimestamp =
      (row as { video_timestamp?: unknown }).video_timestamp;
    if (videoTimestamp !== undefined) {
      if (typeof videoTimestamp !== "string") {
        return {
          ok: false,
          error: `metric_results[${i}].video_timestamp must be a string`,
        };
      }
      input.video_timestamp = videoTimestamp;
    }

    parsed.push(input);
  }

  for (const id of ALL_METRIC_IDS) {
    if (!seen.has(id)) {
      return {
        ok: false,
        error: `Missing required metric_id "${id}"`,
      };
    }
  }

  return { ok: true, metric_results: parsed };
}
