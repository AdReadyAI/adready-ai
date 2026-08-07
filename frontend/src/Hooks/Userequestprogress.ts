import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { ProgressUnit } from '../types/progress'

const POLL_MS = 5_000
const TIMEOUT_MS = 10 * 60_000
const ERROR_THRESHOLD = 2               // consecutive failures before showing a banner
const TERMINAL_STATUSES = new Set(['success', 'error'])

function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  const result = {} as Record<K, T[]>
  for (const item of items) {
    const key = keyFn(item)
    if (!result[key]) result[key] = []
    result[key].push(item)
  }
  return result
}

export function useRequestProgress(batchId: string | undefined) {
  const [units, setUnits] = useState<ProgressUnit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)   // retry button bumps this
  const failuresRef = useRef(0)

  useEffect(() => {
    if (!batchId) return
    let cancelled = false
    const startedAt = Date.now()

    const poll = async () => {
      const { data, error: queryError } = await supabase
        .from('request_pipeline_progress')
        .select('*')
        .eq('batch_id', batchId)
        .order('stage_order')
        .order('sort_order')

      if (cancelled) return

      if (queryError) {
        failuresRef.current += 1
        if (failuresRef.current >= ERROR_THRESHOLD) setError(queryError.message)
        return                                   // keep polling — transient
      }

      failuresRef.current = 0
      setError(null)
      setUnits(data ?? [])

      if (Date.now() - startedAt > TIMEOUT_MS) setTimedOut(true)
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [batchId, reloadKey])

  // Derived, per video.
  const byRequest = useMemo(() => groupBy(units, (u) => u.request_id), [units])
  const isDone = units.length > 0 && units.every((u) => TERMINAL_STATUSES.has(u.status))

  return {
    units,
    byRequest,
    isDone,
    error,
    timedOut,
    retry: () => {
      failuresRef.current = 0
      setTimedOut(false)
      setError(null)
      setReloadKey((k) => k + 1)
    },
  }
}
