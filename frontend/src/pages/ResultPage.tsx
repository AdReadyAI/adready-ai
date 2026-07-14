// Route: /result — Screen 3b "Results & Recommendations". Shows the ranked
// videos, the selected video's launch-readiness scorecard, and an issue
// deep-dive / repair center.

import { useMemo, useState } from 'react'
import DownloadIcon from '../components/icons/DownloadIcon'
import IssueRow from '../components/results/IssueRow'
import MetricBar from '../components/results/MetricBar'
import RankCard from '../components/results/RankCard'
import { STATUS } from '../components/results/status'
import { RESULTS } from '../mocks/results'

export default function ResultPage() {
  const [selectedRank, setSelectedRank] = useState(4) // Video_3 by default
  const selected = useMemo(
    () => RESULTS.find((video) => video.rank === selectedRank) ?? RESULTS[0],
    [selectedRank],
  )
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(
    selected.issues[0]?.id ?? null,
  )

  const status = STATUS[selected.status]

  function selectVideo(rank: number) {
    setSelectedRank(rank)
    const next = RESULTS.find((video) => video.rank === rank)
    setExpandedIssueId(next?.issues[0]?.id ?? null)
  }

  function exportReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      videos: RESULTS.map((video) => ({
        rank: video.rank,
        name: video.name,
        score: video.score,
        status: STATUS[video.status].label,
        metrics: video.metrics,
        issues: video.issues.map((issue) => ({
          timestamp: issue.timestamp,
          tag: issue.tag,
          detail: issue.detail,
        })),
      })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'adready-results.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    // Full-bleed out of AppLayout's centered max-w-4xl main (the -mt-8 cancels
    // that main's py-8 top padding) so the two-column layout has room to
    // breathe, matching the Figma. The AppLayout header stays as the app chrome.
    <div className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 bg-[#f4f4f5] pb-16">
      <main className="mx-auto max-w-[1240px] px-6 py-8">
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

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <div>
            <p className="text-sm font-medium text-slate-400">See results for...</p>
            <h2 className="mt-1 text-4xl font-bold tracking-tight text-slate-900">{selected.name}</h2>

            <p className="mb-5 mt-8 text-lg font-bold text-slate-900">Creative Ranking</p>
            <div className="space-y-4">
              {selected.metrics.map((metric) => (
                <MetricBar key={metric.label} metric={metric} barClass={status.bar} />
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
