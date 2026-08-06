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

describe('IssueClip playback', () => {
  it('parks on the issue frame once metadata loads', () => {
    const { video } = renderClip()
    fireEvent.loadedMetadata(video)

    expect(video.currentTime).toBe(22)
    expect(play).not.toHaveBeenCalled()
  })

  it('clamps a timestamp that falls past the end of the video', () => {
    // duration is stubbed at 30s. Seeking to 300 would show a black end frame.
    const { video } = renderClip({ startSeconds: 300, label: '5:00' })
    fireEvent.loadedMetadata(video)

    expect(video.currentTime).toBe(30)
  })

  it('plays from the issue timestamp when the box is clicked', () => {
    const { video } = renderClip()
    fireEvent.click(screen.getByLabelText('Play clip from 0:22'))

    expect(video.currentTime).toBe(22)
    expect(play).toHaveBeenCalledOnce()
  })

  it('plays from the start when the entire-clip link is clicked', () => {
    const { video } = renderClip()
    fireEvent.click(screen.getByText('→ View entire video clip'))

    expect(video.currentTime).toBe(0)
    expect(play).toHaveBeenCalledOnce()
  })
})

describe('IssueClip reset', () => {
  it('pauses and returns to the issue frame on a click elsewhere', () => {
    const { video } = renderClip()
    fireEvent.click(screen.getByLabelText('Play clip from 0:22'))
    fireEvent.play(video)

    video.currentTime = 26 // stand in for playback advancing
    fireEvent.pointerDown(document.body)

    expect(pause).toHaveBeenCalledOnce()
    expect(video.currentTime).toBe(22)
  })

  it('keeps playing when the click lands inside the player', () => {
    const { video } = renderClip()
    const box = screen.getByLabelText('Play clip from 0:22')
    fireEvent.click(box)
    fireEvent.play(video)

    fireEvent.pointerDown(box)

    expect(pause).not.toHaveBeenCalled()
  })

  it('returns to the issue frame when the clip runs out', () => {
    const { video } = renderClip()
    fireEvent.click(screen.getByLabelText('Play clip from 0:22'))
    fireEvent.play(video)

    video.currentTime = 30
    fireEvent.ended(video)

    expect(video.currentTime).toBe(22)
  })

  it('does not touch the element for outside clicks while idle', () => {
    renderClip()
    fireEvent.pointerDown(document.body)

    expect(pause).not.toHaveBeenCalled()
  })

  it('removes the document listener when the row collapses', () => {
    // Asserted on the listener itself, not on a later click: after unmount the
    // video ref is null and reset() bails early, so a leak would go unnoticed.
    const remove = vi.spyOn(document, 'removeEventListener')
    const { video, unmount } = renderClip()

    fireEvent.click(screen.getByLabelText('Play clip from 0:22'))
    fireEvent.play(video)
    unmount()

    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    remove.mockRestore()
  })

  it('removes the document listener when playback stops', () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const { video } = renderClip()

    fireEvent.click(screen.getByLabelText('Play clip from 0:22'))
    fireEvent.play(video)
    expect(remove).not.toHaveBeenCalledWith('pointerdown', expect.any(Function))

    fireEvent.pause(video)

    expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    remove.mockRestore()
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
    renderClip({ src: SRC, startSeconds: null, label: '1:02:33' })

    expect(screen.getByText('Ad creative frame · 1:02:33')).toBeVisible()
    expect(screen.getByLabelText('Play clip from 1:02:33')).toBeDisabled()
  })

  it('says so plainly when the issue has no frame at all', () => {
    renderClip({ src: SRC, startSeconds: null, label: null })

    expect(screen.getByText('No frame captured')).toBeVisible()
    expect(screen.getByLabelText('No clip available')).toBeDisabled()
  })

  it('falls back to the placeholder when the video fails to load', () => {
    const { container, video } = renderClip()
    fireEvent.error(video)

    expect(container.querySelector('video')).toBeNull()
    expect(screen.queryByText('→ View entire video clip')).toBeNull()
  })
})
