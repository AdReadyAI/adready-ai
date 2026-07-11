// Route: /result — Screen 3b "Results & Recommendations". Shows the ranked
// videos, the selected video's launch-readiness scorecard, and an issue
// deep-dive / repair center.
//
// The data below is mock data (Supabase currently only has the pgmq job queue,
// no `evaluations`/`scorecard` tables yet). It is shaped the way a real fetch
// would return it, so swapping `RESULTS` for a Supabase `select(...)` later is
// a one-line change in this file.

import { useMemo, useState } from 'react'

type ShipStatus = 'ready' | 'revision' | 'nope'
type Severity = 'high' | 'medium'

interface Metric {
  label: string
  /** 0–100 */
  value: number
}

interface Issue {
  id: string
  /** e.g. "0:03" */
  timestamp: string
  /** small badge next to the timestamp, e.g. "Unsupported Claim" */
  tag: string
  /** trailing header title, e.g. "Claim Review" */
  title: string
  severity: Severity
  /** shown as its own pill in the collapsed header when set */
  severityLabel?: string
  detail: string
  frameLabel: string
  repairTitle: string
  repairText: string
}

interface VideoResult {
  rank: number
  name: string
  /** 0–100 overall launch-readiness score */
  score: number
  status: ShipStatus
  thumb: string // tailwind bg class for the thumbnail
  metrics: Metric[]
  summary: string
  issues: Issue[]
}

// ---- mock data -------------------------------------------------------------

const RESULTS: VideoResult[] = [
  {
    rank: 1,
    name: 'Video_4.mp4',
    score: 91,
    status: 'ready',
    thumb: 'bg-rose-100 text-rose-500',
    summary: 'Strong claims, clear story, and on-brief. Ready to go.',
    metrics: [
      { label: 'Claims', value: 88 },
      { label: 'Storyline', value: 92 },
      { label: 'Brief', value: 90 },
      { label: 'Product', value: 94 },
      { label: 'Visual', value: 89 },
    ],
    issues: [],
  },
  {
    rank: 2,
    name: 'Video_1.mp4',
    score: 72,
    status: 'revision',
    thumb: 'bg-violet-100 text-violet-500',
    summary: 'Solid overall — tighten the CTA and support one claim.',
    metrics: [
      { label: 'Claims', value: 70 },
      { label: 'Storyline', value: 68 },
      { label: 'Brief', value: 75 },
      { label: 'Product', value: 72 },
      { label: 'Visual', value: 74 },
    ],
    issues: [
      {
        id: '2-0',
        timestamp: '0:22',
        tag: 'CTA Issue',
        title: 'Weak call to action',
        severity: 'medium',
        severityLabel: 'Medium',
        detail: 'The closing CTA is on screen for under a second and has low contrast.',
        frameLabel: 'Ad creative frame · 0:22',
        repairTitle: 'Strengthen the CTA',
        repairText: 'Hold the CTA card for 2s and raise contrast to meet the brand kit.',
      },
    ],
  },
  {
    rank: 3,
    name: 'Video_2.mp4',
    score: 58,
    status: 'revision',
    thumb: 'bg-emerald-100 text-emerald-500',
    summary: 'Needs stronger product focus and better claim support.',
    metrics: [
      { label: 'Claims', value: 55 },
      { label: 'Storyline', value: 60 },
      { label: 'Brief', value: 52 },
      { label: 'Product', value: 58 },
      { label: 'Visual', value: 64 },
    ],
    issues: [
      {
        id: '3-0',
        timestamp: '0:11',
        tag: 'Product Issue',
        title: 'Product barely visible',
        severity: 'high',
        severityLabel: 'High',
        detail: 'The product appears for less than a second and is out of focus.',
        frameLabel: 'Ad creative frame · 0:11',
        repairTitle: 'Add a clear product hero shot',
        repairText: 'Insert a 2–3s in-focus product shot before the CTA.',
      },
      {
        id: '3-1',
        timestamp: '0:19',
        tag: 'Storyline Issue',
        title: 'Pacing drops mid-ad',
        severity: 'medium',
        severityLabel: 'Medium',
        detail: 'The middle third loses momentum; viewers are likely to drop off.',
        frameLabel: 'Ad creative frame · 0:19',
        repairTitle: 'Tighten the middle section',
        repairText: 'Trim ~3s of B-roll to keep the narrative moving.',
      },
    ],
  },
  {
    rank: 4,
    name: 'Video_3.mp4',
    score: 31,
    status: 'nope',
    thumb: 'bg-emerald-100 text-emerald-500',
    summary: 'Multiple false claims. Product missing. Brief not followed.',
    metrics: [
      { label: 'Claims', value: 20 },
      { label: 'Storyline', value: 35 },
      { label: 'Brief', value: 28 },
      { label: 'Product', value: 30 },
      { label: 'Visual', value: 42 },
    ],
    issues: [
      {
        id: '4-0',
        timestamp: '0:03',
        tag: 'Unsupported Claim',
        title: 'Claim Review',
        severity: 'high',
        detail:
          'On-screen text says "clinically proven" but the product page has no supporting evidence.',
        frameLabel: 'Ad creative frame · 0:03',
        repairTitle: 'Rewrite unsupported claim',
        repairText:
          'Replace "clinically proven" with approved language from your product page.',
      },
      {
        id: '4-1',
        timestamp: '0:28',
        tag: 'CTA Issue',
        title: '"Add missing CTA"',
        severity: 'high',
        severityLabel: 'High',
        detail: 'The ad ends without any call to action or destination.',
        frameLabel: 'Ad creative frame · 0:28',
        repairTitle: 'Add a closing CTA',
        repairText: 'End with a 2s CTA card linking to the product landing page.',
      },
      {
        id: '4-2',
        timestamp: '0:14',
        tag: 'Storyline Issue',
        title: '"Scene transition breaks narrative"',
        severity: 'medium',
        severityLabel: 'Medium',
        detail: 'A hard cut at 0:14 breaks the story and confuses the message.',
        frameLabel: 'Ad creative frame · 0:14',
        repairTitle: 'Smooth the transition',
        repairText: 'Add a bridging shot or crossfade so the scenes connect.',
      },
    ],
  },
]

// ---- status styling --------------------------------------------------------

const STATUS: Record<
  ShipStatus,
  {
    label: string
    pill: string
    scoreBadge: string
    bigCircle: string
    bar: string
  }
> = {
  ready: {
    label: 'Ready to Ship',
    pill: 'bg-green-100 text-green-700',
    scoreBadge: 'bg-green-50 border-green-300 text-green-600',
    bigCircle: 'bg-green-100 border-green-300 text-green-700',
    bar: 'bg-green-500',
  },
  revision: {
    label: 'Needs Revision',
    pill: 'bg-amber-100 text-amber-700',
    scoreBadge: 'bg-amber-50 border-amber-300 text-amber-600',
    bigCircle: 'bg-amber-100 border-amber-300 text-amber-700',
    bar: 'bg-amber-400',
  },
  nope: {
    label: 'Do not ship',
    pill: 'bg-red-100 text-red-600',
    scoreBadge: 'bg-red-100 border-red-300 text-red-500',
    bigCircle: 'bg-red-200 border-red-300 text-red-600',
    bar: 'bg-red-400',
  },
}

// ---- icons -----------------------------------------------------------------

const PlayIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </svg>
)

const ChevronDown = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const DownloadIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// ---- subcomponents ---------------------------------------------------------

function RankCard({
  video,
  selected,
  onSelect,
}: {
  video: VideoResult
  selected: boolean
  onSelect: () => void
}) {
  const s = STATUS[video.status]
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
        selected
          ? 'border-transparent ring-2 ring-violet-500'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          video.rank === 1
            ? 'bg-green-500 text-white'
            : 'border border-slate-200 bg-white text-slate-600'
        }`}
      >
        #{video.rank}
      </span>
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${video.thumb}`}
      >
        <PlayIcon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{video.name}</span>
        <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium ${s.pill}`}>
          {s.label}
        </span>
      </span>
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-lg font-bold ${s.scoreBadge}`}
      >
        {video.score}
      </span>
    </button>
  )
}

function MetricBar({ metric, barClass }: { metric: Metric; barClass: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-20 shrink-0 text-base text-slate-700">{metric.label}</span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full rounded-full ${barClass}`}
          style={{ width: `${metric.value}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-base font-medium text-slate-700">
        {metric.value}
      </span>
    </div>
  )
}

function IssueRow({
  issue,
  expanded,
  onToggle,
}: {
  issue: Issue
  expanded: boolean
  onToggle: () => void
}) {
  const accent = issue.severity === 'high' ? 'border-l-red-500' : 'border-l-amber-400'
  const sevPill =
    issue.severity === 'high' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 border-l-4 bg-white ${accent}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left"
      >
        {issue.severityLabel && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${sevPill}`}>
            {issue.severityLabel}
          </span>
        )}
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {issue.timestamp}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${sevPill}`}>{issue.tag}</span>
        <span className="text-sm font-medium text-slate-700">— {issue.title}</span>
        <ChevronDown
          className={`ml-auto h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-6 border-t border-slate-100 px-5 py-5 md:grid-cols-2">
          {/* left: video frame */}
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">Timestamp</p>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
              <span className="absolute left-3 top-3 text-xs font-medium text-white/90">
                {issue.frameLabel}
              </span>
              <span className="absolute bottom-3 left-3 text-xs font-semibold text-white">
                {issue.timestamp}
              </span>
              <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                <span className="block h-full w-1/4 bg-red-500" />
              </span>
            </div>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
            >
              → View entire video clip
            </button>
          </div>

          {/* right: detail + repair */}
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">Issue Detail</p>
            <p className="text-sm leading-relaxed text-slate-700">{issue.detail}</p>

            <p className="mb-2 mt-5 text-xs font-semibold tracking-wide text-slate-500">
              Repair Workspace
            </p>
            <div className="rounded-lg border-l-4 border-violet-500 bg-slate-100 p-4">
              <p className="text-sm font-semibold text-slate-900">{issue.repairTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{issue.repairText}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- page ------------------------------------------------------------------

export default function ResultPage() {
  const [selectedRank, setSelectedRank] = useState(4) // Video_3 by default
  const selected = useMemo(
    () => RESULTS.find((v) => v.rank === selectedRank) ?? RESULTS[0],
    [selectedRank],
  )
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(
    selected.issues[0]?.id ?? null,
  )

  const status = STATUS[selected.status]

  function selectVideo(rank: number) {
    setSelectedRank(rank)
    const next = RESULTS.find((v) => v.rank === rank)
    setExpandedIssueId(next?.issues[0]?.id ?? null)
  }

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      videos: RESULTS.map((v) => ({
        rank: v.rank,
        name: v.name,
        score: v.score,
        status: STATUS[v.status].label,
        metrics: v.metrics,
        issues: v.issues.map((i) => ({ timestamp: i.timestamp, tag: i.tag, detail: i.detail })),
      })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'adready-results.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    // Full-bleed out of AppLayout's centered max-w-4xl main (the -mt-8 cancels
    // that main's py-8 top padding) so the two-column layout has room to
    // breathe, matching the Figma. The AppLayout header stays as the app chrome.
    <div className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 bg-[#f4f4f5] pb-16">
      <main className="mx-auto max-w-[1240px] px-6 py-8">
        {/* title */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Your results are ready.</h1>
            <p className="mt-1 text-slate-500">
              {RESULTS.length} videos reviewed. Here's how they ranked and what to fix.
            </p>
          </div>
          <button
            type="button"
            onClick={exportReport}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
          >
            <DownloadIcon className="h-4 w-4" />
            Export Report
          </button>
        </div>

        {/* creative ranking */}
        <p className="mb-3 mt-8 text-sm font-semibold text-slate-800">Creative Ranking</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {RESULTS.map((video) => (
            <RankCard
              key={video.rank}
              video={video}
              selected={video.rank === selectedRank}
              onSelect={() => selectVideo(video.rank)}
            />
          ))}
        </div>

        {/* two-column detail */}
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* left: scorecard */}
          <div>
            <p className="text-sm font-medium text-slate-400">See results for...</p>
            <h2 className="mt-1 text-4xl font-bold tracking-tight text-slate-900">{selected.name}</h2>

            <p className="mb-5 mt-8 text-lg font-bold text-slate-900">Creative Ranking</p>
            <div className="space-y-4">
              {selected.metrics.map((m) => (
                <MetricBar key={m.label} metric={m} barClass={status.bar} />
              ))}
            </div>

            <div className="mt-10 flex justify-center">
              <div
                className={`flex h-44 w-44 items-center justify-center rounded-full border-2 text-6xl font-bold ${status.bigCircle}`}
              >
                {selected.score}
              </div>
            </div>

            <p className="mt-8 text-lg leading-relaxed text-slate-600">{selected.summary}</p>
            <div className="mt-5 flex items-center gap-4">
              <span className="text-lg font-bold text-slate-800">Status</span>
              <span className={`rounded-md px-3 py-1 text-lg font-bold ${status.pill}`}>
                {status.label}
              </span>
            </div>
          </div>

          {/* right: issue deep dive */}
          <div className="border-l-4 border-red-500 pl-6">
            <h3 className="text-2xl font-bold text-slate-900">Issue Deep Dive &amp; Repair Center</h3>
            <p className="mt-1 text-sm text-slate-500">
              {selected.name} · {selected.issues.length} issue
              {selected.issues.length === 1 ? '' : 's'} found · Sorted by severity
            </p>

            <div className="mt-6 space-y-4">
              {selected.issues.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
                  <p className="text-sm font-medium text-slate-600">No issues found.</p>
                  <p className="mt-1 text-sm text-slate-400">This creative is ready to ship.</p>
                </div>
              ) : (
                selected.issues.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    expanded={expandedIssueId === issue.id}
                    onToggle={() =>
                      setExpandedIssueId(expandedIssueId === issue.id ? null : issue.id)
                    }
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
