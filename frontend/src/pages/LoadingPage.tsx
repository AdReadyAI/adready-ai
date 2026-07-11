
// Route: /loading — Screen 2 "AI Review". Static visual only.
// TEMPORARY ROUTE: once upload → evaluation → result is wired up, this UI
// moves inside ResultPage as a "still processing" state and this route is
// deleted. No polling / navigation / Supabase logic belongs here.

interface VideoJob {
  name: string
  thumb: string // tailwind bg class
  status: 'In Progress' | 'Completed'
  progress: number // 0-100
}

const VIDEOS: VideoJob[] = [
  { name: 'Video_1.mp4', thumb: 'bg-violet-100 text-violet-500', status: 'In Progress', progress: 55 },
  { name: 'Video_2mp4', thumb: 'bg-emerald-100 text-emerald-500', status: 'In Progress', progress: 25 },
  { name: 'Video_3mp4', thumb: 'bg-amber-100 text-amber-500', status: 'In Progress', progress: 90 },
  { name: 'Video_4mp4', thumb: 'bg-rose-100 text-rose-500', status: 'Completed', progress: 100 },
]

const CHECKS = [
  { title: 'Claim accuracy', desc: 'Verifies all claims against your product page' },
  { title: 'Storyline clarity', desc: 'Checks narrative flow and scene coherence' },
  { title: 'Brief alignment', desc: 'Compares ad against your creative brief' },
  { title: 'Product representation', desc: 'Confirms product appears correctly' },
  { title: 'Visual quality', desc: 'Detects artifacts, text readability, CTA' },
]

const PlayIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
  </svg>
)

function VideoTile({ video }: { video: VideoJob }) {
  const done = video.status === 'Completed'
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
            {video.status}
          </span>
        </div>
      </div>
      <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full rounded-full ${done ? 'bg-green-500' : 'bg-violet-500'}`}
          style={{ width: `${video.progress}%` }}
        />
      </span>
    </div>
  )
}

export default function LoadingPage() {
  return (
    <div className="min-h-screen bg-[#f4f4f5]">
      <main className="mx-auto max-w-[1240px] px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Reviewing your ad creatives...</h1>
        <p className="mt-1 text-slate-500">Hang tight — this usually takes 2–3 minutes. Don't close this tab.</p>

        <div className="mt-6">
          <span className="block h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <span className="block h-full w-3/5 rounded-full bg-violet-600" />
          </span>
          <p className="mt-2 text-sm font-medium text-slate-500">60% complete</p>
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
              {VIDEOS.map((video) => (
                <VideoTile key={video.name} video={video} />
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
              {CHECKS.map((check) => (
                <div key={check.title} className="py-4 first:pt-0 last:pb-0">
                  <p className="font-semibold text-slate-900">{check.title}</p>
                  <p className="mt-0.5 text-sm text-slate-500">{check.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
