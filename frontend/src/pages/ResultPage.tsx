// Route: /result/:batchId — one page, two faces. While the pipeline runs it is a
// live progress view; once every video is terminal it becomes the results view:
// ranked videos, scorecard, and the issue deep-dive.
//
// ## Who owns the clock
//
// `useRequestProgress` is the only thing that polls. It watches the batch's
// pipeline state (see lib/progressTransform.ts, which derives it from
// `requests`, `agent_results` and `result_score_table`) and stops the moment
// every unit is terminal.
//
// The heavy results query fires exactly once, when that flips. That ordering is
// safe rather than racy: a video is only counted done when its scorecard exists
// — `result_score_table` has a row, or `evaluation_completion_status` is
// 'completed', which complete-evaluation only writes *after* both projections
// have succeeded. So by the time we ask for results, they are there.
//
// The previous version polled the results query itself every 5s and inferred
// "still processing" from missing score rows. That could only ever report the
// last stage of four, so it sat at "0 of N scored" for almost the whole run.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import DownloadIcon from '../components/icons/DownloadIcon'
import IssueRow from '../components/results/IssueRow'
import MetricBar from '../components/results/MetricBar'
import ProcessingView from '../components/results/ProcessingView'
import RankCard from '../components/results/RankCard'
import { STATUS } from '../components/results/status'
import { downloadReport } from '../lib/downloadReport'
import { fetchBatchResults } from '../lib/results'
import type { BatchResults } from '../lib/results'
import { emptyIssuesCopy, scoreText } from '../lib/reportModel'
import { getErrorMessage } from '../lib/errorMessage'
import { deleteReviewRequest } from '../lib/reviewRequests'
import { useRequestProgress } from '../lib/useRequestProgress'
import { useSignedVideoUrl } from '../lib/useSignedVideoUrl'
import type { VideoProgress } from '../types/progress'

function Shell({ children }: { children: React.ReactNode }) {
  // Full-bleed out of AppLayout's centered max-w-4xl main (the -mt-8 cancels
  // that main's py-8 top padding) so the two-column layout has room to breathe.
  return (
    <div className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 bg-[#f4f4f5] pb-16">
      <main className="mx-auto max-w-[1240px] px-6 py-8">{children}</main>
    </div>
  )
}

function Notice({
  title,
  body,
  tone = 'neutral',
  onRetry,
}: {
  title: string
  body: string
  tone?: 'neutral' | 'error'
  /** Adds a "Try again" button beside the escape hatch. Omit when nothing is retryable. */
  onRetry?: () => void
}) {
  return (
    <Shell>
      <div
        className={`rounded-2xl border px-6 py-10 text-center ${
          tone === 'error' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
        }`}
      >
        <p className="text-lg font-bold text-slate-900">{title}</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{body}</p>
        <div className="mt-6 flex items-center justify-center gap-3">
          {onRetry !== undefined && (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Try again
            </button>
          )}
          <Link
            to="/upload"
            className="inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Back to upload
          </Link>
        </div>
      </div>
    </Shell>
  )
}

/**
 * The results query's outcome, tagged with the batch it was fetched for.
 *
 * Tagged rather than stored bare so a response can never be rendered under a
 * different batch's URL — see the guard in ResultPage below.
 */
interface LoadedResults {
  batchId: string
  results: BatchResults | null
  error: string | null
}

/**
 * Videos whose pipeline stopped, shown above the ranking.
 *
 * These have no scorecard and so are absent from the ranking entirely. Without
 * this the user submits four videos, gets three back, and is told nothing about
 * the fourth. Explanations are stable user-facing copy derived from terminal
 * states; raw production diagnostics never cross the browser boundary.
 */
function FailedVideos({ videos }: { videos: VideoProgress[] }) {
  return (
    <div className="mb-8 rounded-2xl border border-red-200 bg-red-50 px-6 py-5">
      <p className="font-bold text-red-700">
        {videos.length} {videos.length === 1 ? 'video' : 'videos'} could not be reviewed
      </p>
      <ul className="mt-3 space-y-2">
        {videos.map((video) => (
          <li key={video.requestId} className="text-sm text-red-700">
            <span className="font-semibold">{video.name}</span>
            <span className="break-words"> — {video.fatalError}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Show terminal Failure Reasons when no Ad Creative produced a Scorecard. */
function FailedReviewRequest({
  data,
  failedVideos,
  actionError,
  deleting,
  onDelete,
}: {
  data: BatchResults
  failedVideos: VideoProgress[]
  actionError: string | null
  deleting: boolean
  onDelete: () => void
}) {
  const failuresByRequestId = new Map(
    failedVideos.map((video) => [video.requestId, video.fatalError]),
  )

  return (
    <Shell>
      <div className="max-w-3xl">
        <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
          Review Request failed
        </span>
        <h1 className="mt-4 text-3xl font-bold text-slate-950">
          Some analysis could not be completed.
        </h1>
        <p className="mt-2 max-w-2xl leading-7 text-slate-600">
          {data.videos.length} of {data.totalCount} creatives produced a scorecard.{' '}
          {data.failedCount} {data.failedCount === 1 ? 'creative failed' : 'creatives failed'}
          after automated recovery was exhausted.
        </p>

        {data.pending.length > 0 && (
          <div className="mt-8 rounded-xl bg-white px-6 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.06)]">
            <h2 className="font-bold text-slate-900">Creatives without a scorecard</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {data.pending.map((creative) => {
                const reason = failuresByRequestId.get(creative.requestId)

                // Terminal progress and result rows are fetched separately, so
                // retain a safe fallback if one response briefly lacks detail.
                return (
                  <li key={creative.requestId} className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">{creative.name}</span>
                    <span className="break-words">
                      {' '}
                      — {reason ?? 'The review could not be completed for this creative.'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {actionError && <p className="mt-5 text-sm font-medium text-red-700">{actionError}</p>}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/reviews"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-5 text-sm font-semibold text-slate-800 hover:bg-white"
          >
            Back to reviews
          </Link>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="min-h-11 rounded-lg px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete Review Request'}
          </button>
        </div>
      </div>
    </Shell>
  )
}

export default function ResultPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()

  const { progress, error: progressError, timedOut, retry } = useRequestProgress(batchId)

  const [loaded, setLoaded] = useState<LoadedResults | null>(null)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!batchId) return

    try {
      setLoaded({ batchId, results: await fetchBatchResults(batchId), error: null })
    } catch (err) {
      // An error here is meaningful: RLS denials come back as empty arrays, not
      // errors, so anything thrown is a genuine failure worth surfacing.
      setLoaded({
        batchId,
        results: null,
        error: getErrorMessage(err, 'Could not load your results'),
      })
    }
  }, [batchId])

  // Anything belonging to a different batch is discarded rather than rendered.
  // React Router reuses this component when only the :batchId param changes, so
  // state survives the navigation, and a render always happens before the
  // effects that would react to it — without this check there is a window where
  // the previous batch's ranking shows under the new batch's URL. Same guard as
  // useSignedVideoUrl's out-of-order response check, for the same reason.
  const forThisBatch = loaded?.batchId === batchId ? loaded : null
  const data = forThisBatch?.results ?? null
  const error = forThisBatch?.error ?? null

  // `progress` is a fresh object on every poll, so this depends on the boolean
  // rather than the object — otherwise the results query would re-fire on every
  // tick of a finished batch.
  const isDone = progress?.isDone ?? false

  useEffect(() => {
    if (!isDone) return
    void load()
  }, [isDone, load])

  const selected = useMemo(() => {
    if (!data || data.videos.length === 0) return null
    return data.videos.find((video) => video.requestId === selectedRequestId) ?? data.videos[0]
  }, [data, selectedRequestId])

  // One signature per selected video, shared by all its issue rows. Called here
  // rather than inside IssueRow so switching videos costs one round trip instead
  // of one per issue — and it must sit above the early returns below.
  const videoUrl = useSignedVideoUrl(selected?.videoPath ?? null)

  function selectVideo(requestId: string) {
    setSelectedRequestId(requestId)
    const next = data?.videos.find((video) => video.requestId === requestId)
    setExpandedIssueId(next?.issues[0]?.id ?? null)
  }

  async function exportReport() {
    if (!data || !batchId) return

    setExporting(true)
    setExportError(null)
    try {
      await downloadReport(data, batchId)
    } catch (err) {
      // Surfaced next to the button rather than through the page-level `error`
      // state: a failed export is no reason to replace results the user can
      // still read.
      setExportError(getErrorMessage(err, 'Could not build the PDF'))
    } finally {
      setExporting(false)
    }
  }

  /** Delete the current Review Request and leave its now-invalid result URL. */
  async function removeReviewRequest() {
    if (!batchId) return
    if (!window.confirm('Delete this Review Request and its generated analysis?')) return

    setActionError(null)
    setDeleting(true)
    try {
      await deleteReviewRequest(batchId)
      navigate('/reviews')
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not delete this Review Request'))
      setDeleting(false)
    }
  }

  // ---- the states, in order ----------------------------------------------

  if (!batchId) {
    return (
      <Notice
        title="No batch selected"
        body="This page needs a batch to show. Start a new review from the upload page."
      />
    )
  }

  // Nothing to show *and* we can't reach the server. With a `progress` in hand
  // the poll error is only a banner (see ProcessingView) — the run continues
  // whether or not we can watch it — but with nothing at all this is the page.
  if (progress === null && (progressError !== null || timedOut)) {
    return (
      <Notice
        title="Could not load your review"
        body={progressError ?? 'We stopped checking after ten minutes with no response.'}
        tone="error"
        onRetry={retry}
      />
    )
  }

  if (progress === null) {
    return (
      <Shell>
        <p className="text-slate-500">Loading your results…</p>
      </Shell>
    )
  }

  // Zero requests means the batch id is unknown or belongs to someone else.
  // Those are indistinguishable from here by design: the RLS policies return an
  // empty set rather than revealing that a batch exists but isn't yours.
  if (progress.videos.length === 0) {
    return (
      <Notice
        title="Batch not found"
        body="We couldn't find a review with this link, or it belongs to a different account."
      />
    )
  }

  if (!isDone) {
    return (
      <Shell>
        <ProcessingView
          progress={progress}
          error={progressError}
          timedOut={timedOut}
          onRetry={retry}
        />
      </Shell>
    )
  }

  // Past here the pipeline is finished and we are waiting on / showing the
  // results query, which only runs once isDone flips.
  if (error) {
    return (
      <Notice title="Could not load your results" body={error} tone="error" onRetry={load} />
    )
  }

  if (!data) {
    return (
      <Shell>
        <p className="text-slate-500">Loading your results…</p>
      </Shell>
    )
  }

  // A partial failure still has useful scorecards. Keep the normal ranking and
  // place the failed creatives above it; only a fully failed review needs the
  // dedicated terminal screen.
  if (data.reviewRequestStatus === 'failed') {
    return (
      <FailedReviewRequest
        data={data}
        failedVideos={progress.failed}
        actionError={actionError}
        deleting={deleting}
        onDelete={() => void removeReviewRequest()}
      />
    )
  }

  if (!selected) {
    return (
      <Notice
        title="No results to show"
        body={
          progress.failed.length > 0
            ? `Every video in this batch failed to process. ${progress.failed[0].fatalError}`
            : 'This batch finished without producing any scored videos.'
        }
        tone={progress.failed.length > 0 ? 'error' : 'neutral'}
      />
    )
  }

  const resultStatus = STATUS[selected.status]
  const activeIssueId = expandedIssueId ?? selected.issues[0]?.id ?? null
  const emptyIssues = emptyIssuesCopy(selected.status)

  return (
    <Shell>
      {/* Above the heading on purpose: a partial batch is the one thing the user
          needs to know before reading a ranking that is quietly missing a video. */}
      {progress.failed.length > 0 && <FailedVideos videos={progress.failed} />}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Your results are ready.</h1>
          <p className="mt-1 text-slate-500">
            {data.videos.length} {data.videos.length === 1 ? 'video' : 'videos'} reviewed. Here's
            how they ranked and what to fix.
          </p>
        </div>
        <div className="flex flex-col items-end">
          <button
            type="button"
            onClick={() => void exportReport()}
            disabled={exporting}
            aria-busy={exporting}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-400"
          >
            <DownloadIcon className="h-4 w-4" />
            {/* The first click pays for the lazy PDF chunk on top of the render,
                so without this the button looks dead for a beat. */}
            {exporting ? 'Preparing PDF…' : 'Export Report'}
          </button>
          {exportError !== null && (
            <p className="mt-2 max-w-xs text-right text-sm text-red-600">{exportError}</p>
          )}
        </div>
      </div>

      <p className="mb-3 mt-8 text-sm font-semibold text-slate-800">Creative Ranking</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.videos.map((video) => (
          <RankCard
            key={video.requestId}
            video={video}
            selected={video.requestId === selected.requestId}
            onSelect={() => selectVideo(video.requestId)}
          />
        ))}
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div>
          <p className="text-sm font-medium text-slate-400">See results for...</p>
          <h2 className="mt-1 text-4xl font-bold tracking-tight text-slate-900">{selected.name}</h2>

          <p className="mb-5 mt-8 text-lg font-bold text-slate-900">Score Breakdown</p>
          <div className="space-y-4">
            {selected.metrics.map((metric) => (
              <MetricBar key={metric.id} metric={metric} barClass={resultStatus.bar} />
            ))}
          </div>

          <div className="mt-10 flex justify-center">
            <div
              className={`flex h-44 w-44 items-center justify-center rounded-full border-2 text-6xl font-bold ${resultStatus.bigCircle}`}
            >
              {scoreText(selected.score)}
            </div>
          </div>

          <p className="mt-8 text-lg leading-relaxed text-slate-600">{selected.summary}</p>
          <div className="mt-5 flex items-center gap-4">
            <span className="text-lg font-bold text-slate-800">Status</span>
            <span className={`rounded-md px-3 py-1 text-lg font-bold ${resultStatus.pill}`}>
              {resultStatus.label}
            </span>
          </div>
        </div>

        <div className="lg:border-l lg:border-slate-200 lg:pl-8">
          <h3 className="text-2xl font-bold text-slate-900">Issue Deep Dive &amp; Repair Center</h3>
          <p className="mt-1 text-sm text-slate-500">
            {selected.name} · {selected.issues.length} issue
            {selected.issues.length === 1 ? '' : 's'} found · Sorted by severity
          </p>

          <div className="mt-6 space-y-4">
            {selected.issues.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
                {/* Copy is gated on status, not on issue count, and lives in
                    lib/reportModel.ts so the PDF export says exactly the same
                    thing. See that function for why the distinction matters. */}
                <p className="text-sm font-medium text-slate-600">{emptyIssues.title}</p>
                <p className="mt-1 text-sm text-slate-400">{emptyIssues.body}</p>
              </div>
            ) : (
              selected.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  videoUrl={videoUrl}
                  expanded={activeIssueId === issue.id}
                  onToggle={() =>
                    setExpandedIssueId(activeIssueId === issue.id ? null : issue.id)
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
