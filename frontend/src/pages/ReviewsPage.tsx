import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteReview, listReviews, type ReviewStatus, type ReviewSummary } from '../lib/reviews'

const STATUS: Record<
  ReviewStatus,
  { label: string; detail: string; classes: string }
> = {
  queued: {
    label: 'Queued',
    detail: 'Waiting for media processing to begin',
    classes: 'bg-slate-100 text-slate-700',
  },
  processing: {
    label: 'Processing',
    detail: 'Media processing, evaluation, or scoring is underway',
    classes: 'bg-violet-100 text-violet-700',
  },
  completed: {
    label: 'Completed',
    detail: 'Every creative has a launch-readiness scorecard',
    classes: 'bg-emerald-100 text-emerald-700',
  },
  partially_failed: {
    label: 'Partially failed',
    detail: 'Some creatives completed while others need attention',
    classes: 'bg-amber-100 text-amber-800',
  },
  failed: {
    label: 'Failed',
    detail: 'The review stopped before all creatives were scored',
    classes: 'bg-red-100 text-red-700',
  },
}

function reviewDate(isoDate: string): { primary: string; exact: string } {
  const date = new Date(isoDate)
  return {
    primary: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date),
    exact: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'long',
    }).format(date),
  }
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [activeActionId, setActiveActionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setReviews(await listReviews())
      setPageError(null)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Could not load previous reviews')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete(review: ReviewSummary) {
    const confirmed = window.confirm(
      `Delete the review submitted ${reviewDate(review.createdAt).primary} and its generated analysis?`,
    )
    if (!confirmed) return

    setActionError(null)
    setActiveActionId(review.id)

    try {
      await deleteReview(review.id)
      setReviews((current) => current?.filter((item) => item.id !== review.id) ?? [])
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete this review')
    } finally {
      setActiveActionId(null)
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl pb-12">
      <div className="flex flex-col gap-5 border-b border-slate-200 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-[-0.025em] text-slate-950">Previous reviews</h1>
          <p className="mt-2 max-w-2xl text-base leading-7 text-slate-600">
            Return to completed scorecards or inspect creatives whose automated review could not
            be completed.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(109,40,217,0.22)] transition hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
        >
          Start a new review
        </Link>
      </div>

      {actionError && (
        <div role="alert" className="mt-6 rounded-xl bg-red-50 px-5 py-4 text-sm text-red-800">
          <span className="font-semibold">Action failed.</span> {actionError}
        </div>
      )}

      {pageError && (
        <div className="mt-10 rounded-xl bg-red-50 px-6 py-8" role="alert">
          <h2 className="font-bold text-red-900">Previous reviews could not be loaded</h2>
          <p className="mt-1 text-sm text-red-800">{pageError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
          >
            Try again
          </button>
        </div>
      )}

      {!pageError && reviews === null && (
        <div className="mt-10 space-y-3" aria-label="Loading previous reviews" aria-busy="true">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-200/70" />
          ))}
        </div>
      )}

      {!pageError && reviews?.length === 0 && (
        <div className="mt-10 rounded-2xl bg-white px-6 py-16 text-center shadow-[0_6px_24px_rgba(15,23,42,0.06)]">
          <h2 className="text-xl font-bold text-slate-900">No reviews yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
            Your completed and interrupted ad-creative reviews will appear here after you submit
            the first one.
          </p>
          <Link
            to="/upload"
            className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-5 text-sm font-semibold text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
          >
            Review an ad creative
          </Link>
        </div>
      )}

      {!pageError && reviews && reviews.length > 0 && (
        <ol className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
          {reviews.map((review) => {
            const status = STATUS[review.status]
            const date = reviewDate(review.createdAt)
            const isBusy = activeActionId === review.id

            return (
              <li key={review.id} className="py-6 first:pt-0 sm:first:pt-0">
                <article className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <time dateTime={review.createdAt} title={date.exact} className="font-bold text-slate-950">
                        {date.primary}
                      </time>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.classes}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{status.detail}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {review.creativeCount} {review.creativeCount === 1 ? 'creative' : 'creatives'}
                      {' · '}
                      {review.scoredCount} scored
                      {review.failedCount > 0 && ` · ${review.failedCount} failed`}
                    </p>
                    {review.creativeNames.length > 0 && (
                      <p className="mt-2 truncate text-sm font-medium text-slate-700" title={review.creativeNames.join(', ')}>
                        {review.creativeNames.join(', ')}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Link
                      to={`/result/${review.id}`}
                      className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
                    >
                      View review
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDelete(review)}
                      disabled={activeActionId !== null}
                      className="min-h-10 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                    >
                      {isBusy ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
