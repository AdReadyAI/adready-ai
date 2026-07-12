// Route: /loading — Screen 2 "AI Review".
//
// TEMPORARY ROUTE: once upload → evaluation → result is wired up, this UI
// moves inside ResultPage as a "still processing" state and this route is
// deleted. Progress below is a simulated easing animation for visual
// purposes only — no polling / navigation / Supabase logic belongs here.

import { useEffect, useState } from 'react'

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

// Overall bar eases toward this cap and holds — the final stretch depends on
// the real evaluation finishing, which isn't wired up yet.
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

export default function LoadingPage() {
  const [overall, setOverall] = useState(8)
  const [videoProgress, setVideoProgress] = useState(() => VIDEOS.map(() => 0))

  useEffect(() => {
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
  }, [])

  return (
    <main className="bg-[#f4f4f5] px-6 py-10">
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
        {/* left: spinner + video grid */}
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

        {/* right: what we'll analyze */}
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
