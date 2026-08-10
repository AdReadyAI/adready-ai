// The clip player inside an expanded issue row.
//
// An ordinary video player — play/pause, scrub, volume, fullscreen — with one
// difference: it opens parked on the frame the issue refers to instead of at
// 0:00. Everything after that is the user's to drive.

import { useCallback, useRef, useState } from 'react'

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
  const [failed, setFailed] = useState(false)

  const canPlay = src !== null && startSeconds !== null && !failed

  // Only safe once metadata has loaded — duration is NaN before that, and
  // currentTime cannot be set on a video that has no timeline yet.
  const seekToStart = useCallback(() => {
    const video = videoRef.current
    if (!video || startSeconds === null) return

    // Clamped because nothing guarantees the pipeline's timestamp falls inside
    // the video, and an over-long seek parks it on a black end frame.
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(startSeconds, video.duration)
      : startSeconds
  }, [startSeconds])

  function playFromStartOfVideo() {
    const video = videoRef.current
    if (!video) return

    video.currentTime = 0
    // Inside a user gesture, so this shouldn't reject; catch keeps a blocked
    // playback from surfacing as an unhandled rejection.
    void video.play().catch(() => undefined)
  }

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
        {canPlay ? (
          <video
            ref={videoRef}
            src={src ?? undefined}
            controls
            // Enough to populate the scrubber and let the seek land, without
            // pulling the whole file down before the user asks to watch.
            preload="metadata"
            playsInline
            onLoadedMetadata={seekToStart}
            onError={() => setFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          // No overlay chip in the playable case: the native control bar owns
          // the bottom edge, and the row header already shows the timestamp.
          <span className="absolute left-3 top-3 rounded bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white">
            {label ? `Ad creative frame · ${label}` : 'No frame captured'}
          </span>
        )}
      </div>

      {canPlay && (
        <button
          type="button"
          onClick={playFromStartOfVideo}
          className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
        >
          → View entire video clip
        </button>
      )}
    </div>
  )
}
