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
  AgentResultRow,
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
      'request_id, video_storage_paths, media_processing_status, agents_triggered_at, evaluation_completion_status',
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

  const [agentsResult, scoredResult] = await Promise.all([
    // Only the two columns the checklist needs. agent_results carries the full
    // evaluator payload — explanations, corrections — and pulling all of it
    // every 5 seconds for the whole batch would be wasteful. It has no batch_id
    // column (migration 018), so this filters on request ids.
    supabase.from('agent_results').select('request_id, agent').in('request_id', requestIds),
    supabase.from('result_score_table').select('request_id').eq('batch_id', batchId),
  ])

  if (agentsResult.error) {
    throw new Error(getErrorMessage(agentsResult.error, 'Failed to load evaluator progress'))
  }
  if (scoredResult.error) {
    throw new Error(getErrorMessage(scoredResult.error, 'Failed to load scoring progress'))
  }

  return buildBatchProgress({
    requests: requestRows,
    agents: (agentsResult.data ?? []) as AgentResultRow[],
    scored: (scoredResult.data ?? []) as ScoredRequestRow[],
  })
}
