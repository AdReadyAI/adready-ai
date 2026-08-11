// Loads one batch's live pipeline state. All derivation lives in
// progressTransform.ts; this file is only queries and error handling.
//
// ## Why there is no view behind this
//
// An earlier design put a `security definer` view over `video_processing` so the
// browser could see per-task detail on an otherwise service_role-only table.
// Migration 055 made that unnecessary for the loading screen: it mirrors the
// worker's own stage onto `requests`. Browser access is intentionally limited to
// status columns; raw worker and evaluator diagnostics remain service-role-only.
//
// The cost is granularity — this cannot say "transcription done, OCR running",
// only "media processing running". If that detail is ever wanted, a view is the
// way to get it, and it slots in behind this same function.

import { supabase } from './supabaseClient'
import { getErrorMessage } from './errorMessage'
import { buildBatchProgress } from './progressTransform'
import type {
  EvaluatorRunRow,
  ProgressRequestRow,
  ScoredRequestRow,
} from './progressTransform'
import type { BatchProgress } from '../types/progress'

/**
 * Every table here is behind RLS with an ownership policy, and a denied read
 * comes back as an **empty array, not an error** — so absence is ambiguous
 * between "not yours", "not written yet", and "policy missing". Errors are
 * therefore thrown rather than swallowed: a throw is the only unambiguous signal
 * that something went wrong instead of simply not existing yet.
 */
export async function fetchBatchProgress(batchId: string): Promise<BatchProgress> {
  const { data: requests, error: requestsError } = await supabase
    .from('requests')
    // Deliberately one long literal rather than a concatenation: supabase-js
    // parses this string at the *type* level to infer the row shape, and `+`
    // collapses it to plain `string`, which types the result as an error row.
    .select(
      'request_id, video_storage_paths, media_processing_status, media_processing_failure_code, agents_triggered_at, evaluation_completion_status',
    )
    .eq('batch_id', batchId)

  if (requestsError) {
    throw new Error(getErrorMessage(requestsError, 'Failed to load progress'))
  }

  const requestRows = (requests ?? []) as ProgressRequestRow[]

  // No requests means the batch id is wrong or isn't ours. Bail before firing
  // two more queries that can only come back empty.
  if (requestRows.length === 0) {
    return { videos: [], pct: 0, isDone: false, failed: [] }
  }

  const requestIds = requestRows.map((row) => row.request_id)

  const [evaluatorRunsResult, scoredResult] = await Promise.all([
    // Evaluator Runs are the lifecycle source for progress. Results remain the
    // output source and are intentionally not polled while work is running.
    supabase
      .from('evaluator_runs')
      .select('request_id, evaluator, status')
      .in('request_id', requestIds),
    supabase.from('result_score_table').select('request_id').eq('batch_id', batchId),
  ])

  if (evaluatorRunsResult.error) {
    throw new Error(
      getErrorMessage(evaluatorRunsResult.error, 'Failed to load evaluator progress'),
    )
  }
  if (scoredResult.error) {
    throw new Error(getErrorMessage(scoredResult.error, 'Failed to load scoring progress'))
  }

  return buildBatchProgress({
    requests: requestRows,
    evaluatorRuns: (evaluatorRunsResult.data ?? []) as EvaluatorRunRow[],
    scored: (scoredResult.data ?? []) as ScoredRequestRow[],
  })
}
