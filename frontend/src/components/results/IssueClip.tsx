// The clip player inside an expanded issue row. Click the box to play from the
// issue's timestamp; click anywhere else to pause and return to it. No scrubber
// or controls — this is evidence for an issue, not a media player.

import { useCallback, useEffect, useRef, useState } from 'react'

export default function IssueClip({
  src,
  startSeconds,
  label,
}: {
  /** Signed URL, or null when there is nothing to play yet. */
  src: string | null
  /** Gated on this, not `label`: an unparseable timestamp has text but no seconds. */
  startSeconds: number | null
  /** Display timestamp, e.g. "0:22". */
  label: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLButtonElement>(null)

  // Driven by the element's own play/pause events, so a rejected play() or a
  // pause from anywhere else can't leave this flag lying.
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failed, setFailed] = useState(false)

  const canPlay = src !== null && startSeconds !== null && !failed

  const seekToStart = useCallback(() => {
    const video = videoRef.current
    if (!video || startSeconds === null) return

    // Clamped because nothing guarantees the pipeline's timestamp falls inside
    // the video, and an over-long seek parks it on a black end frame.
    // duration is NaN before metadata and Infinity for streams.
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(startSeconds, video.duration)
      : startSeconds
  }, [startSeconds])

  const reset = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    video.pause()
    seekToStart()
  }, [seekToStart])

  // Attached only while playing, removed on cleanup — a document listener that
  // outlived the element would fire on every click on the page.
  // pointerdown, not click: it lands before focus moves, so clicking another
  // issue row resets this clip and expands that row in one gesture.
  useEffect(() => {
    if (!playing) return

    function handlePointerDown(event: PointerEvent) {
      const box = boxRef.current
      if (box && event.target instanceof Node && box.contains(event.target)) return
      reset()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [playing, reset])

  function playFrom(seconds: number) {
    const video = videoRef.current
    if (!video || !canPlay) return

    video.currentTime = seconds
    // Inside a user gesture, so this shouldn't reject; catch keeps a blocked
    // playback from surfacing as an unhandled rejection.
    void video.play().catch(() => undefined)
  }

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration === 0) return

    setProgress((video.currentTime / video.duration) * 100)
  }

  return (
    <div>
      <button
        ref={boxRef}
        type="button"
        // Replays from the issue's moment even mid-playback.
        onClick={() => startSeconds !== null && playFrom(startSeconds)}
        disabled={!canPlay}
        aria-label={label ? `Play clip from ${label}` : 'No clip available'}
        className="relative block aspect-video w-full overflow-hidden rounded-lg bg-slate-900"
      >
        {canPlay && (
          <video
            ref={videoRef}
            src={src ?? undefined}
            preload="metadata"
            playsInline
            onLoadedMetadata={seekToStart}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={reset}
            onTimeUpdate={handleTimeUpdate}
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          />
        )}

        {/* Hidden while playing so the frame is unobstructed. */}
        {!playing && (
          <span className="absolute left-3 top-3 text-xs font-medium text-white/90">
            {label ? `Ad creative frame · ${label}` : 'No frame captured'}
          </span>
        )}

        {label && (
          <>
            <span className="absolute bottom-3 left-3 text-xs font-semibold text-white">
              {label}
            </span>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
              {/* Real position when playable; the old fixed 25% otherwise. */}
              <span
                className="block h-full bg-red-500 transition-[width] duration-100"
                style={{ width: `${canPlay ? progress : 25}%` }}
              />
            </span>
          </>
        )}
      </button>

      {canPlay && (
        <button
          type="button"
          onClick={() => playFrom(0)}
          className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
        >
          → View entire video clip
        </button>
      )}
    </div>
  )
}
