// Mints a playable URL for a video in the private `uploads` bucket.
//
// The bucket is private (migration 005) with SELECT scoped to the owner's folder
// (migration 006), so the browser signs its own temporary URL. No backend route
// and nothing stored — the URL simply expires.

import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// Comfortably outlives a sitting on the results page, and it is re-signed on
// every mount anyway.
const EXPIRY_SECONDS = 3600

export function useSignedVideoUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    // Cleared first, so the previous video's URL never shows under the next
    // video's issues while the new one signs.
    setUrl(null)
    if (path === null) return

    let cancelled = false

    void supabase.storage
      .from('uploads')
      .createSignedUrl(path, EXPIRY_SECONDS)
      .then(({ data, error }) => {
        // Guards against out-of-order responses: switching videos quickly can
        // resolve an older request last, pairing a clip with the wrong issues.
        if (cancelled) return
        // A failure is not worth breaking the page over — the clip falls back to
        // a static frame and the rest of the results still render.
        setUrl(error ? null : (data?.signedUrl ?? null))
      })

    return () => {
      cancelled = true
    }
  }, [path])

  return url
}
