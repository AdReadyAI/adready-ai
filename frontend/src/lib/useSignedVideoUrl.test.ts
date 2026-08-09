import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSignedUrl = vi.fn()

// Mocked rather than exercised: supabaseClient throws without env vars, and the
// behaviour worth pinning here is the resolution ordering, not the network call.
vi.mock('./supabaseClient', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl }) } },
}))

const { useSignedVideoUrl } = await import('./useSignedVideoUrl')

beforeEach(() => {
  createSignedUrl.mockReset()
})

describe('useSignedVideoUrl', () => {
  it('signs the path and returns the URL', async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/a.mp4' },
      error: null,
    })

    const { result } = renderHook(() => useSignedVideoUrl('user/batch/a.mp4'))

    await waitFor(() => expect(result.current).toBe('https://signed.example/a.mp4'))
    expect(createSignedUrl).toHaveBeenCalledWith('user/batch/a.mp4', 3600)
  })

  it('stays null when there is no path to sign', () => {
    const { result } = renderHook(() => useSignedVideoUrl(null))

    expect(result.current).toBeNull()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('resolves to null when signing fails instead of throwing', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'nope' } })

    const { result } = renderHook(() => useSignedVideoUrl('user/batch/a.mp4'))

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('ignores a stale response after the path changes', async () => {
    // The regression this guards: clicking video A then B, A resolving last,
    // and B's issues ending up pointing at A's clip.
    let resolveA: (value: unknown) => void = () => {}
    createSignedUrl
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockResolvedValueOnce({ data: { signedUrl: 'b.mp4' }, error: null })

    const { result, rerender } = renderHook(({ path }) => useSignedVideoUrl(path), {
      initialProps: { path: 'a-path' },
    })

    rerender({ path: 'b-path' })
    await waitFor(() => expect(result.current).toBe('b.mp4'))

    resolveA({ data: { signedUrl: 'a.mp4' }, error: null })
    await Promise.resolve()

    expect(result.current).toBe('b.mp4')
  })
})
