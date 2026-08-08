// Route: /result/:batchId — the results view: ranked videos, scorecard, and the
// issue deep-dive. Reads result_score_table / result_score_dimensions / issues
// via lib/results.ts.
//
// ⚠️ The processing view here is a deliberate PLACEHOLDER, not the real one.
// The loading experience is owned by `task-pipeline-progress-view.md`, which
// specifies a weighted progress view over all four pipeline stages plus a
// `useRequestProgress` hook. This page only knows about the last stage — a video
// appears once it has a result_score_table row — so it cannot show meaningful
// movement during preprocessing, analysis, or evaluation.
//
// The handoff point is already compatible: that task's D11 completes when every
// unit is terminal *including* the scoring row, which is exactly the `complete`
// flag used here. So LiveProcessingView can replace ProcessingPlaceholder
// without touching anything below it. Poll interval and timeout are set to that
// task's D1/D9 values for the same reason.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DownloadIcon from '../components/icons/DownloadIcon'
import IssueRow from '../components/results/IssueRow'
import MetricBar from '../components/results/MetricBar'
import RankCard from '../components/results/RankCard'
import { STATUS } from '../components/results/status'
import { downloadReport } from '../lib/downloadReport'
import { fetchBatchResults } from '../lib/results'
import type { BatchResults } from '../lib/results'
import { emptyIssuesCopy, scoreText } from '../lib/reportModel'
import { getErrorMessage } from '../lib/errorMessage'
import { useSignedVideoUrl } from '../lib/useSignedVideoUrl'

// Matches task-pipeline-progress-view.md D1 (5000ms) and D9 (10 minutes) so the
// real progress view is a drop-in swap rather than a behaviour change.
const POLL_MS = 5000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

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
}: {
  title: string
  body: string
  tone?: 'neutral' | 'error'
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
        <Link
          to="/upload"
          className="mt-6 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
        >
          Back to upload
        </Link>
      </div>
    </Shell>
  )
}

/**
 * PLACEHOLDER loading view. See the file header.
 *
 * Shows only what this page can honestly know: how many videos in the batch have
 * produced a score row. That is the pipeline's final stage, so this sits at 0%
 * for most of a real run. The weighted, per-stage progress view specified in
 * task-pipeline-progress-view.md replaces this wholesale — it is intentionally
 * small so there is little to unpick when that lands.
 */
function ProcessingPlaceholder({
  data,
  timedOut,
}: {
  data: BatchResults
  timedOut: boolean
}) {
  const done = data.videos.length

  return (
    <Shell>
      <h1 className="text-3xl font-bold text-slate-900">Reviewing your ad creatives...</h1>
      <p className="mt-1 text-slate-500">
        {done} of {data.totalCount} scored. This usually takes 2–3 minutes.
      </p>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-8">
        <div className="flex items-center gap-4">
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-900" />
          <div>
            <p className="font-semibold text-slate-900">Analyzing your creatives…</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {data.pending.length} still processing
              {data.pending.length > 0 && `: ${data.pending.map((v) => v.name).join(', ')}`}
            </p>
          </div>
        </div>
      </div>

      {timedOut && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="font-bold text-amber-700">This is taking longer than expected.</p>
          <p className="mt-1 text-sm text-amber-700">
            We've stopped checking for now. Reload the page to resume.
          </p>
        </div>
      )}
    </Shell>
  )
}

export default function ResultPage() {
  const { batchId } = useParams<{ batchId: string }>()

  const [data, setData] = useState<BatchResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!batchId) return null

    try {
      const next = await fetchBatchResults(batchId)
      setData(next)
      setError(null)
      return next
    } catch (err) {
      // An error here is meaningful: RLS denials come back as empty arrays, not
      // errors, so anything thrown is a genuine failure worth surfacing.
      setError(getErrorMessage(err, 'Could not load your results'))
      return null
    }
  }, [batchId])

  useEffect(() => {
    if (!batchId) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined
    const startedAt = Date.now()
    setTimedOut(false)

    const stop = () => {
      if (intervalId !== undefined) clearInterval(intervalId)
      intervalId = undefined
    }

    const tick = async () => {
      const next = await load()
      if (cancelled) return

      if (next?.complete) {
        stop()
        return
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setTimedOut(true)
        stop()
      }
    }

    void (async () => {
      const first = await load()
      // Only start an interval if the batch is actually still running — a
      // finished batch should cost exactly one query.
      if (cancelled || first === null || first.complete) return
      intervalId = setInterval(() => void tick(), POLL_MS)
    })()

    return () => {
      cancelled = true
      stop()
    }
  }, [batchId, load])

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

  // ---- the five states --------------------------------------------------

  if (!batchId) {
    return (
      <Notice
        title="No batch selected"
        body="This page needs a batch to show. Start a new review from the upload page."
      />
    )
  }

  if (error) {
    return <Notice title="Could not load your results" body={error} tone="error" />
  }

  if (!data) {
    return (
      <Shell>
        <p className="text-slate-500">Loading your results…</p>
      </Shell>
    )
  }

  // Zero requests means the batch id is unknown or belongs to someone else.
  // Those are indistinguishable from here by design: the RLS policies return an
  // empty set rather than revealing that a batch exists but isn't yours.
  if (data.totalCount === 0) {
    return (
      <Notice
        title="Batch not found"
        body="We couldn't find a review with this link, or it belongs to a different account."
      />
    )
  }

  if (!data.complete) {
    return <ProcessingPlaceholder data={data} timedOut={timedOut} />
  }

  if (!selected) {
    return (
      <Notice
        title="No results to show"
        body="This batch finished without producing any scored videos."
      />
    )
  }

  const resultStatus = STATUS[selected.status]
  const activeIssueId = expandedIssueId ?? selected.issues[0]?.id ?? null
  const emptyIssues = emptyIssuesCopy(selected.status)

  return (
    <Shell>
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

        <div className="border-l-4 border-red-500 pl-6">
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
