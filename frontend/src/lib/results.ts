// Loads one batch's Result UI data. All transformation lives in
// resultsTransform.ts; this file is only queries and error handling.

import { supabase } from './supabaseClient'
import { getErrorMessage } from './errorMessage'
import { assembleVideoResults } from './resultsTransform'
import type {
  BatchResults,
  DimensionRow,
  IssueRow,
  RequestRow,
  ScoreRow,
} from './resultsTransform'

/**
 * Every one of these tables is behind RLS with an ownership policy (migration
 * 043). A denied read comes back as an empty array, NOT an error — so an empty
 * result is genuinely ambiguous between "not yours", "nothing there yet", and
 * "policy missing". Errors are surfaced loudly for that reason: a thrown error
 * is the only signal we get that something went wrong rather than being absent.
 */
export async function fetchBatchResults(batchId: string): Promise<BatchResults> {
  const { data: requests, error: requestsError } = await supabase
    .from('requests')
    .select('request_id, video_storage_paths')
    .eq('batch_id', batchId)

  if (requestsError) {
    throw new Error(getErrorMessage(requestsError, 'Failed to load this batch'))
  }

  const requestRows = (requests ?? []) as RequestRow[]

  // No requests means the batch id is wrong or isn't ours. Bail before firing
  // three more queries that can only come back empty.
  if (requestRows.length === 0) {
    return { videos: [], pending: [], totalCount: 0, complete: false }
  }

  const requestIds = requestRows.map((row) => row.request_id)

  const [scoresResult, dimensionsResult, issuesResult, reviewResult] = await Promise.all([
    supabase
      .from('result_score_table')
      .select('request_id, ad_readiness_pct, readiness_status')
      .eq('batch_id', batchId),
    // result_score_dimensions has no batch_id column — its only link to a batch
    // is through result_score_table — so it filters on request ids instead.
    supabase
      .from('result_score_dimensions')
      .select('request_id, dimension_id, name, score')
      .in('request_id', requestIds),
    supabase
      .from('issues')
      .select(
        'request_id, metric_id, title, detail, severity, repair_suggestion, video_timestamp',
      )
      .eq('batch_id', batchId),
    supabase
      .from('review_request_summaries')
      .select('failed_count, failed_request_ids, status')
      .eq('review_request_id', batchId)
      .maybeSingle(),
  ])

  if (scoresResult.error) {
    throw new Error(getErrorMessage(scoresResult.error, 'Failed to load scores'))
  }
  if (dimensionsResult.error) {
    throw new Error(
      getErrorMessage(dimensionsResult.error, 'Failed to load score breakdown'),
    )
  }
  if (issuesResult.error) {
    throw new Error(getErrorMessage(issuesResult.error, 'Failed to load issues'))
  }
  if (reviewResult.error) {
    throw new Error(getErrorMessage(reviewResult.error, 'Failed to load review status'))
  }

  const assembled = assembleVideoResults({
    requests: requestRows,
    scores: (scoresResult.data ?? []) as ScoreRow[],
    dimensions: (dimensionsResult.data ?? []) as DimensionRow[],
    issues: (issuesResult.data ?? []) as IssueRow[],
  })

  return {
    ...assembled,
    failedCount: Number(reviewResult.data?.failed_count ?? 0),
    failedRequestIds: (reviewResult.data?.failed_request_ids ?? []) as string[],
    reviewStatus: reviewResult.data?.status,
  }
}

export type { BatchResults }
