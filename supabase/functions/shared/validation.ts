/** Final public-output validation for all agents. */
import { MetricResultSchema } from "./schemas.ts";
import type { MetricResult, SubCheckResult } from "./schemas.ts";

function assertMetricSemantics(
  result: Pick<MetricResult, "metric_id" | "result" | "severity">,
): void {
  const valid = result.result === "true"
    ? result.severity === "none"
    : result.result === "false"
    ? result.severity !== "none" && result.severity !== "cannot_assess"
    : result.severity === "cannot_assess";
  if (!valid) {
    throw new Error(
      `Invalid result/severity pair for ${result.metric_id}: ${result.result}/${result.severity}`,
    );
  }
}

function assertSubCheckSemantics(check: SubCheckResult): void {
  const valid = check.result === "passed"
    ? check.severity === "none"
    : check.result === "failed"
    ? check.severity !== "none" && check.severity !== "cannot_assess"
    : check.severity === "cannot_assess";
  if (!valid) {
    throw new Error(
      `Invalid sub-check result/severity pair for ${check.check_id}: ${check.result}/${check.severity}`,
    );
  }
}

/**
 * Validates the common API/database shape and semantic result invariants.
 * Call once after an agent has assembled all of its results and before either
 * persistence or an HTTP success response.
 */
export function validateMetricResults(input: unknown): MetricResult[] {
  const results = MetricResultSchema.array().parse(input);
  const seenKeys = new Set<string>();

  for (const result of results) {
    assertMetricSemantics(result);
    const key = `${result.agent}:${result.metric_id}`;
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate metric result returned: ${key}`);
    }
    seenKeys.add(key);
    for (const check of result.sub_checks ?? []) assertSubCheckSemantics(check);
  }

  return results;
}
