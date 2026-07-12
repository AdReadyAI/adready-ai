import type { VideoResult } from '../../types/results'
import PlayIcon from '../icons/PlayIcon'
import { STATUS } from './status'

export default function RankCard({
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
