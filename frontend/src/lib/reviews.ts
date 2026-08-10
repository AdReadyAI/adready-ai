import { getErrorMessage } from './errorMessage'
import { supabase } from './supabaseClient'

export type ReviewStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partially_failed'
  | 'failed'

export type ReviewSummary = {
  id: string
  retryOfId: string | null
  createdAt: string
  creativeCount: number
  creativeNames: string[]
  scoredCount: number
  failedCount: number
  status: ReviewStatus
}

type ReviewSummaryRow = {
  review_request_id: string
  retry_of_review_request_id: string | null
  created_at: string
  creative_count: number
  creative_paths: string[] | null
  scored_count: number
  failed_count: number
  status: ReviewStatus
}

/** Return a human-readable filename without exposing the private storage key. */
function creativeName(storagePath: string): string {
  const encodedName = storagePath.split('/').at(-1)
  if (!encodedName) return 'Untitled creative'

  try {
    return decodeURIComponent(encodedName)
  } catch {
    // A malformed legacy path should not prevent the rest of history loading.
    return encodedName
  }
}

/** Load the current user's visible Review Requests in reverse chronology. */
export async function listReviews(): Promise<ReviewSummary[]> {
  const { data, error } = await supabase
    .from('review_request_summaries')
    .select(
      'review_request_id, retry_of_review_request_id, created_at, creative_count, creative_paths, scored_count, failed_count, status',
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(getErrorMessage(error, 'Failed to load previous reviews'))
  }

  return ((data ?? []) as ReviewSummaryRow[]).map((row) => ({
    id: row.review_request_id,
    retryOfId: row.retry_of_review_request_id,
    createdAt: row.created_at,
    creativeCount: row.creative_count,
    creativeNames: (row.creative_paths ?? []).map(creativeName),
    scoredCount: row.scored_count,
    failedCount: row.failed_count,
    status: row.status,
  }))
}

/**
 * Start a complete new attempt with the source Review Request's uploaded
 * assets and Campaign Context. The client-minted id makes network retries and
 * repeated clicks resolve to the same attempt.
 */
export async function retryReview(
  sourceReviewRequestId: string,
  newReviewRequestId = crypto.randomUUID(),
): Promise<string> {
  const { data, error } = await supabase.rpc('retry_review_request', {
    p_source_review_request_id: sourceReviewRequestId,
    p_new_review_request_id: newReviewRequestId,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Failed to retry this review'))
  }

  return (data as string | null) ?? newReviewRequestId
}

/**
 * Start a focused Review Retry for one terminally failed Ad Creative while
 * preserving the source Review Request as immutable history.
 */
export async function retryAdCreative(
  sourceReviewRequestId: string,
  sourceRequestId: string,
  newReviewRequestId = crypto.randomUUID(),
): Promise<string> {
  const { data, error } = await supabase.rpc('retry_ad_creative_review_request', {
    p_source_review_request_id: sourceReviewRequestId,
    p_source_request_id: sourceRequestId,
    p_new_review_request_id: newReviewRequestId,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Failed to retry this Ad Creative'))
  }

  return (data as string | null) ?? newReviewRequestId
}

/** Remove a Review Request and its generated analysis from visible history. */
export async function deleteReview(reviewRequestId: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_review_request', {
    p_review_request_id: reviewRequestId,
  })

  if (error) {
    throw new Error(getErrorMessage(error, 'Failed to delete this review'))
  }

  if (data !== true) {
    throw new Error('This review no longer exists or has already been deleted')
  }
}
