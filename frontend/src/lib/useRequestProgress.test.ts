// Fake timers throughout, so every assertion here is deterministic rather than
// racing a real 5-second interval.
//
// Note `waitFor` is deliberately absent: it polls on a timer of its own, which
// deadlocks against fake timers. `advance` below drives the clock explicitly
// instead — after it resolves, every effect the tick caused has already run.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchProgress } from '../types/progress'

// Mocked rather than exercised: supabaseClient throws without env vars, and what
// is worth pinning here is the polling lifecycle, not the query.
const fetchBatchProgress = vi.fn()
vi.mock('./progress', () => ({ fetchBatchProgress }))

const { useRequestProgress } = await import('./useRequestProgress')

const POLL_MS = 5_000
const TIMEOUT_MS = 10 * 60_000

function batch(isDone: boolean): BatchProgress {
  return { videos: [], pct: isDone ? 100 : 40, isDone, failed: [] }
}

/**
 * Runs the clock forward and lets everything it triggered settle.
 *
 * The trailing microtask flushes matter: a poll is `fetch -> await -> setState`,
 * so the state update lands a tick after the timer callback returns.
 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Settles the immediate first poll, which fires on mount rather than on a timer. */
const settle = () => advance(0)

beforeEach(() => {
  vi.useFakeTimers()
  fetchBatchProgress.mockReset()
  fetchBatchProgress.mockResolvedValue(batch(false))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRequestProgress', () => {
  it('does nothing without a batch id', () => {
    renderHook(() => useRequestProgress(undefined))

    expect(fetchBatchProgress).not.toHaveBeenCalled()
  })

  // Otherwise the loading screen is blank for the first five seconds.
  it('polls immediately on mount, then on the interval', async () => {
    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()

    expect(result.current.progress).not.toBeNull()
    expect(fetchBatchProgress).toHaveBeenCalledTimes(1)
    expect(fetchBatchProgress).toHaveBeenCalledWith('batch-1')

    await advance(POLL_MS)
    expect(fetchBatchProgress).toHaveBeenCalledTimes(2)

    await advance(POLL_MS)
    expect(fetchBatchProgress).toHaveBeenCalledTimes(3)
  })

  it('stops polling once the batch is done', async () => {
    fetchBatchProgress.mockResolvedValue(batch(true))

    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()

    expect(result.current.progress?.isDone).toBe(true)

    // A finished batch opened from a link should cost exactly one round trip —
    // this is also the race the hook guards by arming the interval only after
    // the first poll resolves.
    await advance(POLL_MS * 4)
    expect(fetchBatchProgress).toHaveBeenCalledTimes(1)
  })

  it('stops polling when a running batch finishes mid-flight', async () => {
    fetchBatchProgress.mockResolvedValueOnce(batch(false)).mockResolvedValue(batch(true))

    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()

    await advance(POLL_MS)
    expect(result.current.progress?.isDone).toBe(true)

    await advance(POLL_MS * 3)
    expect(fetchBatchProgress).toHaveBeenCalledTimes(2)
  })

  it('clears the interval on unmount', async () => {
    const { unmount } = renderHook(() => useRequestProgress('batch-1'))
    await settle()

    unmount()
    await advance(POLL_MS * 3)

    expect(fetchBatchProgress).toHaveBeenCalledTimes(1)
  })

  // A transient 500 or a dropped network must not permanently kill progress on
  // a run that is otherwise fine.
  it('keeps polling after a failure', async () => {
    fetchBatchProgress.mockRejectedValueOnce(new Error('boom'))

    renderHook(() => useRequestProgress('batch-1'))
    await settle()

    await advance(POLL_MS)
    expect(fetchBatchProgress).toHaveBeenCalledTimes(2)
  })

  it('does not surface a single blip', async () => {
    fetchBatchProgress.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()

    expect(result.current.error).toBeNull()
  })

  it('surfaces two consecutive failures', async () => {
    fetchBatchProgress.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()
    await advance(POLL_MS)

    expect(result.current.error).toBe('boom')
  })

  it('clears the banner and resets the counter after a success', async () => {
    fetchBatchProgress
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(batch(false))

    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()
    await advance(POLL_MS)
    expect(result.current.error).toBe('boom')

    await advance(POLL_MS)
    expect(result.current.error).toBeNull()

    // Counter reset, so the next single failure is a blip again, not a banner.
    fetchBatchProgress.mockRejectedValueOnce(new Error('boom'))
    await advance(POLL_MS)
    expect(result.current.error).toBeNull()
  })

  it('gives up after ten minutes and stops polling', async () => {
    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()

    // The deadline check is strictly `>`, so it is the first poll *past* ten
    // minutes that gives up, not the one landing exactly on it.
    await advance(TIMEOUT_MS + POLL_MS)
    expect(result.current.timedOut).toBe(true)

    const callsAtTimeout = fetchBatchProgress.mock.calls.length
    await advance(POLL_MS * 3)
    expect(fetchBatchProgress).toHaveBeenCalledTimes(callsAtTimeout)
  })

  it('restarts the clock on retry', async () => {
    const { result } = renderHook(() => useRequestProgress('batch-1'))
    await settle()
    await advance(TIMEOUT_MS + POLL_MS)
    expect(result.current.timedOut).toBe(true)

    const callsBefore = fetchBatchProgress.mock.calls.length
    act(() => {
      result.current.retry()
    })
    await settle()

    expect(result.current.timedOut).toBe(false)
    expect(fetchBatchProgress.mock.calls.length).toBeGreaterThan(callsBefore)

    // The timer is running again rather than merely having fired once.
    const callsAfterRetry = fetchBatchProgress.mock.calls.length
    await advance(POLL_MS)
    expect(fetchBatchProgress.mock.calls.length).toBeGreaterThan(callsAfterRetry)
  })
})
