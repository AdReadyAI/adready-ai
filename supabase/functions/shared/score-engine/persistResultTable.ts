import type { ResultTable } from "./types.ts";

export interface ResultScoreTableRow {
  request_id: string;
  batch_id: string;
  config_version: string;
  ad_readiness_pct: number | null;
  readiness_status: string;
  updated_at: string;
}

export interface ResultScoreDimensionRow {
  request_id: string;
  dimension_id: string;
  name: string;
  score: number | null;
}

/**
 * Pure mapping: ResultTable → rows for 026 result_score_* tables.
 * "Cannot Assess" dimension scores become NULL.
 */
export function resultTableToDbRows(
  requestId: string,
  batchId: string,
  resultTable: ResultTable,
  updatedAt: string = new Date().toISOString(),
): {
  overall: ResultScoreTableRow;
  dimensions: ResultScoreDimensionRow[];
} {
  return {
    overall: {
      request_id: requestId,
      batch_id: batchId,
      config_version: resultTable.config_version,
      ad_readiness_pct: resultTable.ad_readiness_pct,
      readiness_status: resultTable.readiness_status,
      updated_at: updatedAt,
    },
    dimensions: resultTable.dimensions.map((d) => ({
      request_id: requestId,
      dimension_id: d.id,
      name: d.name,
      score: d.score === "Cannot Assess" ? null : d.score,
    })),
  };
}
