import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IssueClip from './IssueClip'

const SRC = 'https://signed.example/clip.mp4'

// jsdom implements neither play/pause nor a writable currentTime, so the media
// element is stubbed at the prototype and playback is asserted through it.
let play: ReturnType<typeof vi.fn>
let pause: ReturnType<typeof vi.fn>

beforeEach(() => {
  play = vi.fn().mockResolvedValue(undefined)
  pause = vi.fn()

  let currentTime = 0
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: play },
    pause: { configurable: true, value: pause },
    duration: { configurable: true, get: () => 30 },
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      },
    },
  })
})

function renderClip(overrides: Partial<Parameters<typeof IssueClip>[0]> = {}) {
  const view = render(
    <IssueClip src={SRC} startSeconds={22} label="0:22" {...overrides} />,
  )
  const video = view.container.querySelector('video') as HTMLVideoElement
  return { ...view, video }
}

describe('IssueClip', () => {
  it('opens parked on the issue frame, paused', () => {
    const { video } = renderClip()
    fireEvent.loadedMetadata(video)

    expect(video.currentTime).toBe(22)
    expect(play).not.toHaveBeenCalled()
  })

  it('exposes the browser controls so the clip can be scrubbed', () => {
    // The whole point of the player: everything after the initial seek is the
    // user's to drive.
    const { video } = renderClip()

    expect(video).toHaveAttribute('controls')
  })

  it('clamps a timestamp that falls past the end of the video', () => {
    // duration is stubbed at 30s. Seeking to 300 would show a black end frame.
    const { video } = renderClip({ startSeconds: 300, label: '5:00' })
    fireEvent.loadedMetadata(video)

    expect(video.currentTime).toBe(30)
  })

  it('leaves the position alone when the user clicks elsewhere on the page', () => {
    // The regression this guards: an earlier version reset to the issue frame
    // on any outside click, which would throw away a scrub mid-review.
    const { video } = renderClip()
    fireEvent.loadedMetadata(video)

    video.currentTime = 12 // stand in for the user scrubbing
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)

    expect(video.currentTime).toBe(12)
    expect(pause).not.toHaveBeenCalled()
  })

  it('does not re-seek on its own once metadata has loaded', () => {
    const { video, rerender } = renderClip()
    fireEvent.loadedMetadata(video)

    video.currentTime = 5
    rerender(<IssueClip src={SRC} startSeconds={22} label="0:22" />)

    expect(video.currentTime).toBe(5)
  })

  it('plays from the start when the entire-clip link is clicked', () => {
    const { video } = renderClip()
    fireEvent.loadedMetadata(video)
    fireEvent.click(screen.getByText('→ View entire video clip'))

    expect(video.currentTime).toBe(0)
    expect(play).toHaveBeenCalledOnce()
  })
})

describe('IssueClip without a playable video', () => {
  it('shows the placeholder frame while the URL is still being signed', () => {
    const { container } = renderClip({ src: null })

    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText('Ad creative frame · 0:22')).toBeVisible()
    expect(screen.queryByText('→ View entire video clip')).toBeNull()
  })

  it('offers no clip for a timestamp it cannot seek to', () => {
    // normalizeTimestamp keeps "1:02:33" displayable; parseTimestampSeconds
    // gives it no seconds, so there is nowhere to seek.
    const { container } = renderClip({ src: SRC, startSeconds: null, label: '1:02:33' })

    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByText('Ad creative frame · 1:02:33')).toBeVisible()
  })

  it('says so plainly when the issue has no frame at all', () => {
    renderClip({ src: SRC, startSeconds: null, label: null })

    expect(screen.getByText('No frame captured')).toBeVisible()
  })

  it('falls back to the placeholder when the video fails to load', () => {
    const { container, video } = renderClip()
    fireEvent.error(video)

    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByText('→ View entire video clip')).toBeNull()
  })
})
