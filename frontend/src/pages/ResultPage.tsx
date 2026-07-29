// Route: /result — Screen 3 "AI Review" (processing) → Screen 3b "Results &
// Recommendations" (ranked videos, scorecard, issue deep-dive/repair center).
//
// The processing view's progress is a simulated easing animation — there's
// no real job-status API yet, so it's mocked and just transitions to the
// results view on its own after a short delay.

import { useEffect, useMemo, useState } from 'react'
import DownloadIcon from '../components/icons/DownloadIcon'
import IssueRow from '../components/results/IssueRow'
import MetricBar from '../components/results/MetricBar'
import RankCard from '../components/results/RankCard'
import { STATUS } from '../components/results/status'
import { RESULTS } from '../mocks/results'

// ---- processing state -------------------------------------------------

interface VideoJob {
  name: string
  thumb: string // tailwind bg class
  speed: number // relative animation speed
}

const VIDEOS: VideoJob[] = [
  { name: 'Video_1.mp4', thumb: 'bg-violet-100 text-violet-500', speed: 0.8 },
  { name: 'Video_2.mp4', thumb: 'bg-emerald-100 text-emerald-500', speed: 0.55 },
  { name: 'Video_3.mp4', thumb: 'bg-amber-100 text-amber-500', speed: 1.2 },
  { name: 'Video_4.mp4', thumb: 'bg-rose-100 text-rose-500', speed: 2.2 },
]

const CHECKS = [
  { title: 'Claim accuracy', desc: 'Verifies all claims against your product page', threshold: 10 },
  { title: 'Storyline clarity', desc: 'Checks narrative flow and scene coherence', threshold: 30 },
  { title: 'Brief alignment', desc: 'Compares ad against your creative brief', threshold: 50 },
  { title: 'Product representation', desc: 'Confirms product appears correctly', threshold: 70 },
  { title: 'Visual quality', desc: 'Detects artifacts, text readability, CTA', threshold: 88 },
]

// Overall bar eases toward this cap, then a short pause simulates the
// evaluation wrapping up before the results view takes over.
const OVERALL_CAP = 97
const TICK_MS = 300

const PlayIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </svg>
)

const CheckIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function VideoTile({ video, progress }: { video: VideoJob; progress: number }) {
  const done = progress >= 100
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${video.thumb}`}>
          <PlayIcon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">{video.name}</p>
          <span
            className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
              done ? 'bg-green-100 text-green-700' : 'bg-violet-100 text-violet-600'
            }`}
          >
            {done ? 'Completed' : 'In Progress'}
          </span>
        </div>
      </div>
      <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full rounded-full transition-[width] duration-300 ${done ? 'bg-green-500' : 'bg-violet-500'}`}
          style={{ width: `${progress}%` }}
        />
      </span>
    </div>
  )
}

function ProcessingView({ overall, videoProgress }: { overall: number; videoProgress: number[] }) {
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8">
      <h1 className="text-3xl font-bold text-slate-900">Reviewing your ad creatives...</h1>
      <p className="mt-1 text-slate-500">Hang tight — this usually takes 2–3 minutes. Don't close this tab.</p>

      <div className="mt-6">
        <span className="block h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          <span
            className="block h-full rounded-full bg-violet-600 transition-[width] duration-300"
            style={{ width: `${overall}%` }}
          />
        </span>
        <p className="mt-2 text-sm font-medium text-slate-500">{Math.round(overall)}% complete</p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <div className="flex flex-col items-center py-6">
            <div className="flex h-40 w-40 animate-pulse items-center justify-center rounded-full bg-slate-900">
              <PlayIcon className="h-16 w-16 text-white" />
            </div>
            <p className="mt-6 text-xl font-bold text-slate-900">Analyzing your creatives...</p>
            <p className="mt-1 text-slate-500">This will take a couple of minutes; sit back and relax.</p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
            {VIDEOS.map((video, i) => (
              <VideoTile key={video.name} video={video} progress={videoProgress[i]} />
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-violet-200 bg-violet-50 px-6 py-5">
            <p className="font-bold text-violet-700">Almost there!</p>
            <p className="mt-1 text-sm text-violet-600">
              We'll show you the ranked scorecard and repair recommendations once all checks are done.
            </p>
          </div>
        </div>

        <div className="h-fit rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-lg font-bold text-slate-900">What we'll analyze</p>
          <div className="mt-4 divide-y divide-slate-100">
            {CHECKS.map((check) => {
              const done = overall >= check.threshold
              return (
                <div key={check.title} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      done ? 'border-green-500 bg-green-500' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {done && <CheckIcon className="h-3 w-3 text-white" />}
                  </span>
                  <div>
                    <p className={`font-semibold ${done ? 'text-slate-900' : 'text-slate-400'}`}>
                      {check.title}
                    </p>
                    <p className={`mt-0.5 text-sm ${done ? 'text-slate-500' : 'text-slate-400'}`}>
                      {check.desc}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </main>
  )
}

// ---- page ---------------------------------------------------------------

export default function ResultPage() {
  const [status, setStatus] = useState<'processing' | 'ready'>('processing')
  const [overall, setOverall] = useState(8)
  const [videoProgress, setVideoProgress] = useState(() => VIDEOS.map(() => 0))

  // Simulated progress ticking, only while processing.
  useEffect(() => {
    if (status !== 'processing') return
    const id = setInterval(() => {
      setOverall((prev) => (prev >= OVERALL_CAP - 0.2 ? prev : prev + (OVERALL_CAP - prev) * 0.04))
      setVideoProgress((prev) =>
        prev.map((p, i) => {
          if (p >= 100) return 100
          const next = p + (100 - p) * 0.035 * VIDEOS[i].speed
          return next >= 99.5 ? 100 : next
        }),
      )
    }, TICK_MS)
    return () => clearInterval(id)
  }, [status])

  // Once the bar nears its cap, hold briefly then reveal results. This is a
  // stand-in for the real "evaluation finished" signal.
  useEffect(() => {
    if (status !== 'processing' || overall < OVERALL_CAP - 0.2) return
    const timeout = setTimeout(() => setStatus('ready'), 800)
    return () => clearTimeout(timeout)
  }, [status, overall])

  const [selectedRank, setSelectedRank] = useState(4) // Video_3 by default
  const selected = useMemo(
    () => RESULTS.find((video) => video.rank === selectedRank) ?? RESULTS[0],
    [selectedRank],
  )
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(
    selected.issues[0]?.id ?? null,
  )

  const resultStatus = STATUS[selected.status]

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
      {status === 'processing' ? (
        <ProcessingView overall={overall} videoProgress={videoProgress} />
      ) : (
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
                  <MetricBar key={metric.label} metric={metric} barClass={resultStatus.bar} />
                ))}
              </div>

              <div className="mt-10 flex justify-center">
                <div
                  className={`flex h-44 w-44 items-center justify-center rounded-full border-2 text-6xl font-bold ${resultStatus.bigCircle}`}
                >
                  {selected.score}
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
      )}
    </div>
  )
}
