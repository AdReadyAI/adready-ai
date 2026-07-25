// Route: /result — Screen 3 "AI Review" (processing) → Screen 3b "Results &
// Recommendations" (ranked videos, scorecard, issue deep-dive/repair center).
//
// PROCESSING STATE
// The "processing" view now pulls real data from `video_processing` instead
// of a fake timer, via useVideoProcessing() below. A few things to know
// about how it's built, since the backend schema for this table is still
// evolving:
//
//   - Tracking is keyed by request_id, not a separate video_id — request_id
//     is being treated as the video identifier for now. This means progress
//     is tracked per request, not per individual video within a request.
//     If a request ever holds multiple videos, they'll all show the same
//     aggregate progress (see videoNames in LiveProcessingView) — that's a
//     known simplification, not a bug, until per-video tracking exists.
//
//   - `status` on video_processing currently only has two real values in the
//     DB: 'success' and 'error'. There's no pending/in-progress value yet.
//     The code doesn't hardcode that though — it treats anything that ISN'T
//     'success' or 'error' as "not done yet" (see TERMINAL_STATUSES). That
//     means it'll work correctly the moment a pending-style status ships,
//     with no changes needed here.
//
//   - task_name is not a fixed, agreed-upon list yet — it's already grown
//     across migrations. Rather than hardcode a checklist of task names (and
//     have it go stale), the checklist renders dynamically from whatever
//     task_name rows actually come back for a given request_id.
//
//   - A request is considered "done" once every task_name row we've seen for
//     it has a terminal status (success or error).
//
//   - KNOWN BLOCKER: as of this writing, only the service_role has SELECT
//     access on video_processing — there's no grant/RLS policy for the
//     authenticated role yet. Until that's added, this subscription will
//     connect successfully but simply never receive any rows, and the UI
//     will sit at "Waiting for processing to start…" indefinitely. That's
//     expected given the current backend state, not a frontend bug.
//
//   - The "use existing campaign" flow on the upload form never creates a
//     real requests row, so it has no request_id to subscribe with. That
//     path falls back to the old simulated easing animation
//     (SimulatedProcessingView / useSimulatedProgress below), which is
//     otherwise unchanged from before.

import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import DownloadIcon from '../components/icons/DownloadIcon'
import IssueRow from '../components/results/IssueRow'
import MetricBar from '../components/results/MetricBar'
import RankCard from '../components/results/RankCard'
import { STATUS } from '../components/results/status'
import { RESULTS } from '../mocks/results'

// ---- real processing state (video_processing subscription) --------------

type TaskStatus = string // 'success' | 'error' today; more values expected later
const TERMINAL_STATUSES = new Set(['success', 'error'])

interface ResultNavState {
  requestId?: string
  videoPaths?: string[]
}

function humanizeTaskName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function filenameFromPath(path: string) {
  return path.split('/').pop() ?? path
}

function useVideoProcessing(requestId: string | undefined) {
  const [tasks, setTasks] = useState<Record<string, TaskStatus>>({})

  useEffect(() => {
    if (!requestId) return
    let cancelled = false
    setTasks({})

    supabase
      .from('video_processing')
      .select('task_name, status')
      .eq('request_id', requestId)
      .then(({ data }) => {
        if (cancelled || !data) return
        setTasks(Object.fromEntries(data.map((row) => [row.task_name, row.status])))
      })

    const channel = supabase
      .channel(`video_processing:${requestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'video_processing', filter: `request_id=eq.${requestId}` },
        (payload) => {
          const row = payload.new as { task_name?: string; status?: string } | null
          if (!row?.task_name) return
          setTasks((prev) => ({ ...prev, [row.task_name as string]: row.status ?? '' }))
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [requestId])

  const taskEntries = Object.entries(tasks)
  const totalTasks = taskEntries.length
  const completedTasks = taskEntries.filter(([, status]) => TERMINAL_STATUSES.has(status)).length
  const overallProgress = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100)
  const isDone = totalTasks > 0 && completedTasks === totalTasks

  return { taskEntries, overallProgress, isDone }
}

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

function LiveProcessingView({
  videoNames,
  overallProgress,
  taskEntries,
}: {
  videoNames: string[]
  overallProgress: number
  taskEntries: [string, TaskStatus][]
}) {
  return (
    <main className="mx-auto max-w-[1240px] px-6 py-8">
      <h1 className="text-3xl font-bold text-slate-900">Reviewing your ad creatives...</h1>
      <p className="mt-1 text-slate-500">Hang tight — this usually takes 2–3 minutes. Don't close this tab.</p>

      <div className="mt-6">
        <span className="block h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
          <span
            className="block h-full rounded-full bg-violet-600 transition-[width] duration-300"
            style={{ width: `${overallProgress}%` }}
          />
        </span>
        <p className="mt-2 text-sm font-medium text-slate-500">{overallProgress}% complete</p>
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

          {/* Progress is currently tracked per request, not per individual video, so
              every video listed here shares the same aggregate percentage. */}
          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
            {videoNames.map((name) => (
              <div key={name} className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-500">
                  <PlayIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                  <span className="mt-1 inline-block rounded-md bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-600">
                    In Progress
                  </span>
                </div>
              </div>
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
            {taskEntries.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">Waiting for processing to start…</p>
            ) : (
              taskEntries.map(([taskName, status]) => {
                const done = TERMINAL_STATUSES.has(status)
                const errored = status === 'error'
                return (
                  <div key={taskName} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        errored
                          ? 'border-red-500 bg-red-500'
                          : done
                            ? 'border-green-500 bg-green-500'
                            : 'border-slate-300 bg-white'
                      }`}
                    >
                      {done && <CheckIcon className="h-3 w-3 text-white" />}
                    </span>
                    <p className={`font-semibold ${done ? 'text-slate-900' : 'text-slate-400'}`}>
                      {humanizeTaskName(taskName)}
                      {errored && <span className="ml-2 text-xs font-normal text-red-500">Failed</span>}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

// ---- simulated fallback (used only when there's no real request_id, e.g. the
// "use existing campaign" mock path) --------------------------------------

interface VideoJob {
  name: string
  thumb: string
  speed: number
}

const SIM_VIDEOS: VideoJob[] = [
  { name: 'Video_1.mp4', thumb: 'bg-violet-100 text-violet-500', speed: 0.8 },
  { name: 'Video_2.mp4', thumb: 'bg-emerald-100 text-emerald-500', speed: 0.55 },
  { name: 'Video_3.mp4', thumb: 'bg-amber-100 text-amber-500', speed: 1.2 },
  { name: 'Video_4.mp4', thumb: 'bg-rose-100 text-rose-500', speed: 2.2 },
]

const SIM_CHECKS = [
  { title: 'Claim accuracy', desc: 'Verifies all claims against your product page', threshold: 10 },
  { title: 'Storyline clarity', desc: 'Checks narrative flow and scene coherence', threshold: 30 },
  { title: 'Brief alignment', desc: 'Compares ad against your creative brief', threshold: 50 },
  { title: 'Product representation', desc: 'Confirms product appears correctly', threshold: 70 },
  { title: 'Visual quality', desc: 'Detects artifacts, text readability, CTA', threshold: 88 },
]

const SIM_OVERALL_CAP = 97
const SIM_TICK_MS = 300

function SimVideoTile({ video, progress }: { video: VideoJob; progress: number }) {
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

function useSimulatedProgress(active: boolean) {
  const [overall, setOverall] = useState(8)
  const [videoProgress, setVideoProgress] = useState(() => SIM_VIDEOS.map(() => 0))

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      setOverall((prev) => (prev >= SIM_OVERALL_CAP - 0.2 ? prev : prev + (SIM_OVERALL_CAP - prev) * 0.04))
      setVideoProgress((prev) =>
        prev.map((p, i) => {
          if (p >= 100) return 100
          const next = p + (100 - p) * 0.035 * SIM_VIDEOS[i].speed
          return next >= 99.5 ? 100 : next
        }),
      )
    }, SIM_TICK_MS)
    return () => clearInterval(id)
  }, [active])

  return { overall, videoProgress, isDone: overall >= SIM_OVERALL_CAP - 0.2 }
}

function SimulatedProcessingView({ overall, videoProgress }: { overall: number; videoProgress: number[] }) {
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
            {SIM_VIDEOS.map((video, i) => (
              <SimVideoTile key={video.name} video={video} progress={videoProgress[i]} />
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
            {SIM_CHECKS.map((check) => {
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
  const location = useLocation()
  const navState = (location.state ?? {}) as ResultNavState
  const requestId = navState.requestId
  const videoNames = useMemo(
    () => (navState.videoPaths ?? []).map(filenameFromPath),
    [navState.videoPaths],
  )

  const [status, setStatus] = useState<'processing' | 'ready'>('processing')

  const live = useVideoProcessing(requestId)
  const sim = useSimulatedProgress(status === 'processing' && !requestId)

  const done = requestId ? live.isDone : sim.isDone

  useEffect(() => {
    if (status !== 'processing' || !done) return
    const timeout = setTimeout(() => setStatus('ready'), 600)
    return () => clearTimeout(timeout)
  }, [status, done])

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
        requestId ? (
          <LiveProcessingView
            videoNames={videoNames}
            overallProgress={live.overallProgress}
            taskEntries={live.taskEntries}
          />
        ) : (
          <SimulatedProcessingView overall={sim.overall} videoProgress={sim.videoProgress} />
        )
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
