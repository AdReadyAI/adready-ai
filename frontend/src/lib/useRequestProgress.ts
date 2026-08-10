// Polls one batch's pipeline state while it runs.
//
// Lives in lib/ beside useSignedVideoUrl.ts rather than in a hooks/ directory —
// the repo keeps a flat lib/ + types/ layout and this is the second hook, not
// enough to justify a third top-level folder.
//
// ## Why polling and not Realtime
//
// A Supabase Realtime subscription would need the table added to the
// `supabase_realtime` publication, which nothing in this repo has ever done —
// and its absence fails *silently*: the channel reports SUBSCRIBED, delivers
// nothing, and looks exactly like a job that has not started. You would also
// still need this polling path as a fallback, because a dropped socket during a
// 3-minute job strands the user with no signal at all. At 5 seconds against a
// 2-3 minute pipeline the difference is imperceptible.
//
// If sub-second updates are ever genuinely wanted, Realtime is purely additive:
// it would feed the same BatchProgress shape and nothing downstream changes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchBatchProgress } from './progress'
import { getErrorMessage } from './errorMessage'
import type { BatchProgress } from '../types/progress'

const POLL_MS = 5_000

/**
 * No signal for ten minutes means the worker is gone, not slow. Measured from
 * mount rather than from the last successful poll: this page's job has a known
 * ceiling, so "it has been ten minutes" is the question worth asking.
 */
const TIMEOUT_MS = 10 * 60_000

/**
 * Consecutive failures before the user is told.
 *
 * One blip should not flash an error banner over a run that is fine — mobile
 * networks drop a request routinely. Two in a row (10 seconds of nothing) is a
 * real problem.
 */
const ERROR_THRESHOLD = 2

export interface RequestProgressState {
  /** Null until the first poll resolves. */
  progress: BatchProgress | null
  /** Set only after ERROR_THRESHOLD consecutive failures. Polling continues regardless. */
  error: string | null
  /** Polling gave up. Terminal — only `retry` clears it. */
  timedOut: boolean
  retry: () => void
}

export function useRequestProgress(batchId: string | undefined): RequestProgressState {
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  // Bumped by `retry` to re-enter the effect, which restarts the clock. A plain
  // function call could not reset `startedAt`, since it is per-effect-run.
  const [reloadKey, setReloadKey] = useState(0)
  const failuresRef = useRef(0)

  useEffect(() => {
    if (batchId === undefined) return

    let cancelled = false
    let finished = false
    let intervalId: ReturnType<typeof setInterval> | undefined
    const startedAt = Date.now()

    failuresRef.current = 0
    setProgress(null)
    setError(null)
    setTimedOut(false)

    const stop = () => {
      finished = true
      if (intervalId !== undefined) clearInterval(intervalId)
      intervalId = undefined
    }

    const poll = async () => {
      try {
        const next = await fetchBatchProgress(batchId)
        if (cancelled) return

        failuresRef.current = 0
        setError(null)
        setProgress(next)

        // Nothing will change again, so stop asking. A finished batch that is
        // opened from a link costs exactly one round trip.
        if (next.isDone) {
          stop()
          return
        }
      } catch (err) {
        if (cancelled) return

        // Deliberately does NOT stop the interval. A transient 500 or a dropped
        // network should not permanently kill progress on a run that is fine.
        failuresRef.current += 1
        if (failuresRef.current >= ERROR_THRESHOLD) {
          setError(getErrorMessage(err, 'Could not check on your review'))
        }
      }

      if (Date.now() - startedAt > TIMEOUT_MS) {
        setTimedOut(true)
        stop()
      }
    }

    void (async () => {
      // The interval is only armed after the first poll resolves. Arming it
      // up front would race: a batch that is already finished calls stop()
      // inside that first poll, before `intervalId` has been assigned, and the
      // timer would then outlive it.
      await poll()
      if (cancelled || finished) return
      intervalId = setInterval(() => void poll(), POLL_MS)
    })()

    return () => {
      // Both are required. `cancelled` prevents setState after unmount;
      // clearInterval stops the timer. Neither alone is sufficient — an
      // in-flight request resolves after the timer is gone.
      cancelled = true
      stop()
    }
  }, [batchId, reloadKey])

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  return { progress, error, timedOut, retry }
}
