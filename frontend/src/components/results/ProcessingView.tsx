// The loading screen — what the pipeline is doing, per video, while the user
// waits. Replaces the old ProcessingPlaceholder, which could only count score
// rows and therefore sat at 0% for almost the entire run.
//
// Every number and every tick here traces back to a row the pipeline wrote. See
// lib/progressTransform.ts for the derivation.
//
// ## Why the checklist is per video and not per batch
//
// A batch-level rollup was tried and it lies. With one failed video out of four,
// every row collapses to a red "Skipped" while the other three are running along
// perfectly well. Videos in a batch have genuinely different fates, so each one
// carries its own checklist and its own colour.

import PlayIcon from '../icons/PlayIcon'
import type { BatchProgress, ProgressUnit, UnitStatus, VideoProgress } from '../../types/progress'

/**
 * One palette, indexed by status, used by every coloured thing on this screen.
 *
 * Note `warning` is amber and keeps its tick. It means the run hit trouble but
 * carried on and will still produce a result — painting it red would tell the
 * user their review failed while it is actively still running, the same mistake
 * as colouring `unassessed` like a bad score over in status.ts.
 */
const TONE: Record<
  UnitStatus,
  {
    pill: string
    pillLabel: string
    bar: string
    /** Card border + wash. Only terminal states tint the card itself. */
    card: string
    stageLabel: string
    /** The check circle: fill/border, plus the colour of the glyph inside it. */
    mark: string
    detail: string
  }
> = {
  queued: {
    pill: 'bg-slate-100 text-slate-500',
    pillLabel: 'Queued',
    bar: 'bg-slate-300',
    card: 'border-slate-200 bg-white',
    stageLabel: 'text-slate-400',
    mark: 'border-slate-300 bg-slate-50',
    detail: 'text-slate-400',
  },
  processing: {
    pill: 'bg-violet-100 text-violet-700',
    pillLabel: 'In Progress',
    bar: 'bg-violet-500',
    card: 'border-violet-200 bg-white',
    stageLabel: 'text-violet-600',
    mark: 'border-violet-500 bg-violet-100',
    detail: 'text-violet-600',
  },
  success: {
    pill: 'bg-green-100 text-green-700',
    pillLabel: 'Completed',
    bar: 'bg-green-500',
    card: 'border-green-200 bg-green-50/40',
    stageLabel: 'text-green-600',
    mark: 'border-green-500 bg-green-500 text-white',
    detail: 'text-slate-500',
  },
  warning: {
    pill: 'bg-amber-100 text-amber-700',
    pillLabel: 'Partial',
    bar: 'bg-amber-400',
    card: 'border-amber-200 bg-amber-50/50',
    stageLabel: 'text-amber-600',
    mark: 'border-amber-400 bg-amber-400 text-white',
    detail: 'text-amber-700',
  },
  error: {
    pill: 'bg-red-100 text-red-600',
    pillLabel: 'Failed',
    bar: 'bg-red-400',
    card: 'border-red-200 bg-red-50/60',
    stageLabel: 'text-red-600',
    mark: 'border-red-500 bg-red-500 text-white',
    detail: 'text-red-600',
  },
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className}>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CrossIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

function BangIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className}>
      <path d="M12 6v7M12 17v.5" strokeLinecap="round" />
    </svg>
  )
}

function Bar({
  pct,
  status,
  label,
  thick = false,
}: {
  pct: number
  status: UnitStatus
  label: string
  thick?: boolean
}) {
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`block w-full overflow-hidden rounded-full bg-slate-200 ${thick ? 'h-2.5' : 'h-1.5'}`}
    >
      {/* Width is the only animated property, so the bar eases between polls
          instead of snapping every 5 seconds. */}
      <span
        className={`block h-full rounded-full transition-[width] duration-700 ease-out ${TONE[status].bar}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}

/** The circle at the start of a checklist row — the main carrier of colour. */
function Mark({ status }: { status: UnitStatus }) {
  const tone = TONE[status]

  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${tone.mark}`}
    >
      {status === 'success' && <CheckIcon className="h-3 w-3" />}
      {status === 'warning' && <BangIcon className="h-3 w-3" />}
      {status === 'error' && <CrossIcon className="h-3 w-3" />}
      {status === 'processing' && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-600" />
      )}
    </span>
  )
}

function UnitRow({ unit, hideDetail }: { unit: ProgressUnit; hideDetail: boolean }) {
  const tone = TONE[unit.status]

  return (
    <li className="flex items-start gap-3">
      <Mark status={unit.status} />
      <div className="min-w-0">
        <p
          className={`text-sm ${unit.status === 'queued' ? 'text-slate-400' : 'font-medium text-slate-800'}`}
        >
          {unit.label}
          {/* Screen readers get the state as words; sighted users get the mark. */}
          <span className="sr-only"> — {unit.status}</span>
        </p>
        {/* Producer text, so it can be long and technical. break-words keeps a
            stack trace or a URL from blowing out the card. */}
        {unit.detail !== null && !hideDetail && (
          <p className={`mt-0.5 break-words text-xs ${tone.detail}`}>{unit.detail}</p>
        )}
      </div>
    </li>
  )
}

function VideoCard({ video }: { video: VideoProgress }) {
  const tone = TONE[video.status]

  return (
    <div className={`rounded-2xl border px-6 py-5 shadow-sm ${tone.card}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${video.thumb}`}
        >
          <PlayIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900" title={video.name}>
            {video.name}
          </p>
          <span
            className={`mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium ${tone.pill}`}
          >
            {tone.pillLabel}
          </span>
        </div>
        {/* A stopped run has every unit terminal, which makes the weighted
            percentage read 100 — "100% Failed" is nonsense. The number means
            nothing once the pipeline gave up, so it isn't shown. */}
        <span className="ml-auto shrink-0 text-lg font-bold tabular-nums text-slate-700">
          {video.fatalError === null ? `${video.pct}%` : '—'}
        </span>
      </div>

      <div className="mt-4">
        <Bar pct={video.pct} status={video.status} label={`${video.name} progress`} />
      </div>

      {video.fatalError !== null && (
        <p className="mt-4 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">Processing stopped.</span> {video.fatalError}
        </p>
      )}

      {/* Section headers come from the data, not a hardcoded list, so a stage
          added in progressTransform appears here with no change to this file. */}
      <div className="mt-5 space-y-4">
        {video.stages.map((stage) => (
          <div key={stage.key}>
            <p
              className={`text-xs font-semibold uppercase tracking-wide ${TONE[stage.status].stageLabel}`}
            >
              {stage.label}
            </p>
            <ul className="mt-2 space-y-2">
              {stage.units.map((unit) => (
                <UnitRow
                  key={unit.key}
                  unit={unit}
                  // On a stopped card the banner above already says what broke,
                  // and every remaining detail is the same "Skipped" sentence
                  // repeated once per unit. The red marks carry it on their own.
                  hideDetail={video.fatalError !== null}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ProcessingView({
  progress,
  error,
  timedOut,
  onRetry,
}: {
  progress: BatchProgress
  /** Poll failures. Distinct from a video's own failure, which lives on its card. */
  error: string | null
  timedOut: boolean
  onRetry: () => void
}) {
  const count = progress.videos.length

  return (
    <>
      <h1 className="text-3xl font-bold text-slate-900">Reviewing your ad creatives...</h1>
      <p className="mt-1 text-slate-500">
        {count} {count === 1 ? 'video' : 'videos'} in this batch. Hang tight — this usually takes
        2–3 minutes.
      </p>

      <div className="mt-6">
        <Bar pct={progress.pct} status="processing" label="Overall progress" thick />
        <p className="mt-2 text-sm font-semibold text-violet-700">{progress.pct}% complete</p>
      </div>

      {/* A poll failure is about *our* connection, not about the run — the
          pipeline keeps going regardless, so the copy says so and the cards
          below stay on screen showing the last known state. */}
      {error !== null && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4">
          <p className="font-bold text-amber-800">We've lost contact with the server.</p>
          <p className="mt-1 text-sm text-amber-700">
            Your review is still running — we just can't read its status right now. {error}
          </p>
        </div>
      )}

      {timedOut && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="font-bold text-amber-800">This is taking longer than expected.</p>
          <p className="mt-1 text-sm text-amber-700">
            We've stopped checking for now. The job may have failed.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Check again
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {progress.videos.map((video) => (
          <VideoCard key={video.requestId} video={video} />
        ))}
      </div>
    </>
  )
}
