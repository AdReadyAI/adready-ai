// Covers ResultPage's 5 states (no batchId / error / loading / not found /
// processing / ready), the polling lifecycle (interval start/stop, timeout,
// cleanup on unmount), and the export button's success/failure paths.
//
// RankCard/MetricBar/IssueRow are exercised through their rendered text only
// (not their internal markup, which this file has no visibility into) — these
// are integration-style tests of ResultPage's data wiring, not full coverage
// of those child components.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import ResultPage from './ResultPage'
import type { BatchResults, PendingVideo } from '../lib/resultsTransform'
import type { VideoResult, Issue } from '../types/results'

const { fetchBatchResultsMock, downloadReportMock, paramsRef } = vi.hoisted(() => ({
  fetchBatchResultsMock: vi.fn(),
  downloadReportMock: vi.fn(),
  paramsRef: { current: {} as { batchId?: string } },
}))

vi.mock('../lib/results', () => ({
  fetchBatchResults: fetchBatchResultsMock,
}))

vi.mock('../lib/downloadReport', () => ({
  downloadReport: downloadReportMock,
}))

vi.mock('react-router-dom', () => ({
  useParams: () => paramsRef.current,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

function makeVideo(overrides: Partial<VideoResult> = {}): VideoResult {
  return {
    requestId: 'req-1',
    rank: 1,
    name: 'ad.mp4',
    score: 82,
    status: 'ready',
    thumb: 'bg-violet-100 text-violet-500',
    metrics: [],
    summary: 'No issues found.',
    issues: [],
    ...overrides,
  }
}

function makeBatch(overrides: Partial<BatchResults> = {}): BatchResults {
  return {
    videos: [],
    pending: [],
    totalCount: 0,
    complete: false,
    ...overrides,
  }
}

const POLL_MS = 5000
const TIMEOUT_MS = 10 * 60 * 1000

beforeEach(() => {
  fetchBatchResultsMock.mockReset()
  downloadReportMock.mockReset()
  paramsRef.current = { batchId: 'batch-1' }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ResultPage — no batchId', () => {
  it('shows "No batch selected" and never calls fetchBatchResults', () => {
    paramsRef.current = {}
    render(<ResultPage />)

    expect(screen.getByText('No batch selected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to upload' })).toHaveAttribute('href', '/upload')
    expect(fetchBatchResultsMock).not.toHaveBeenCalled()
  })
})

describe('ResultPage — error state', () => {
  it('shows the thrown error message', async () => {
    fetchBatchResultsMock.mockRejectedValue(new Error('network down'))
    render(<ResultPage />)

    await waitFor(() => expect(screen.getByText('Could not load your results')).toBeInTheDocument())
    expect(screen.getByText('network down')).toBeInTheDocument()
  })
})

describe('ResultPage — loading state', () => {
  it('shows a loading message before the first fetch resolves', async () => {
    let resolveFetch: (value: BatchResults) => void = () => {}
    fetchBatchResultsMock.mockReturnValue(
      new Promise<BatchResults>((resolve) => {
        resolveFetch = resolve
      }),
    )

    render(<ResultPage />)
    expect(screen.getByText('Loading your results…')).toBeInTheDocument()

    resolveFetch(makeBatch({ totalCount: 0 }))
    await waitFor(() => expect(screen.getByText('Batch not found')).toBeInTheDocument())
  })
})

describe('ResultPage — batch not found', () => {
  it('shows "Batch not found" when totalCount is 0', async () => {
    fetchBatchResultsMock.mockResolvedValue(makeBatch({ totalCount: 0 }))
    render(<ResultPage />)

    await waitFor(() => expect(screen.getByText('Batch not found')).toBeInTheDocument())
  })
})

describe('ResultPage — processing placeholder', () => {
  it('lists pending videos and the scored/total count', async () => {
    const pending: PendingVideo[] = [
      { requestId: 'req-1', name: 'ad1.mp4' },
      { requestId: 'req-2', name: 'ad2.mp4' },
    ]
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({ totalCount: 2, complete: false, videos: [], pending }),
    )

    render(<ResultPage />)

    await waitFor(() => expect(screen.getByText('Reviewing your ad creatives...')).toBeInTheDocument())
    expect(screen.getByText('0 of 2 scored. This usually takes 2–3 minutes.')).toBeInTheDocument()
    expect(screen.getByText(/2 still processing: ad1\.mp4, ad2\.mp4/)).toBeInTheDocument()
  })

  it('polls every 5s while incomplete and stops once the batch completes', async () => {
    vi.useFakeTimers()
    const incomplete = makeBatch({
      totalCount: 1,
      complete: false,
      pending: [{ requestId: 'req-1', name: 'ad.mp4' }],
    })
    const complete = makeBatch({ totalCount: 1, complete: true, videos: [makeVideo()] })
    fetchBatchResultsMock
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(incomplete)
      .mockResolvedValueOnce(complete)

    render(<ResultPage />)
    await vi.advanceTimersByTimeAsync(0) // flush the immediate first load()
    expect(fetchBatchResultsMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(fetchBatchResultsMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(fetchBatchResultsMock).toHaveBeenCalledTimes(3)

    // Batch is now complete — further ticks must not poll again.
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    expect(fetchBatchResultsMock).toHaveBeenCalledTimes(3)
  })

  it('shows the timeout notice and stops polling after 10 minutes of no completion', async () => {
    vi.useFakeTimers()
    const incomplete = makeBatch({
      totalCount: 1,
      complete: false,
      pending: [{ requestId: 'req-1', name: 'ad.mp4' }],
    })
    fetchBatchResultsMock.mockResolvedValue(incomplete)

    render(<ResultPage />)
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS)

    expect(screen.getByText('This is taking longer than expected.')).toBeInTheDocument()
    const callsAtTimeout = fetchBatchResultsMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    expect(fetchBatchResultsMock).toHaveBeenCalledTimes(callsAtTimeout)
  })
})

describe('ResultPage — no results despite completion', () => {
  it('shows a fallback notice (defensive branch — should not occur given assembleVideoResults\' invariant)', async () => {
    fetchBatchResultsMock.mockResolvedValue(makeBatch({ totalCount: 1, complete: true, videos: [] }))
    render(<ResultPage />)

    await waitFor(() => expect(screen.getByText('No results to show')).toBeInTheDocument())
  })
})

describe('ResultPage — ready state', () => {
  it('renders the results view and switches videos on selection', async () => {
    const issue: Issue = {
      id: 'req-2_m1',
      metricId: 'm1',
      title: 'Weak CTA',
      detail: 'The CTA is unclear.',
      severity: 'high',
      repairText: 'Add a clear CTA.',
      timestamp: '0:22',
    }
    const videoA = makeVideo({ requestId: 'req-1', name: 'ad1.mp4', rank: 1, score: 90 })
    const videoB = makeVideo({
      requestId: 'req-2',
      name: 'ad2.mp4',
      rank: 2,
      score: 40,
      status: 'revision',
      issues: [issue],
      summary: '1 issue found — 1 high',
    })
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({ totalCount: 2, complete: true, videos: [videoA, videoB] }),
    )

    render(<ResultPage />)

    await waitFor(() => expect(screen.getByText('Your results are ready.')).toBeInTheDocument())
    expect(screen.getByText("2 videos reviewed. Here's how they ranked and what to fix.")).toBeInTheDocument()
    expect(screen.getAllByText('ad1.mp4').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('ad2.mp4'))

    expect(screen.getByText('Weak CTA')).toBeInTheDocument()
  })

  it('shows an "unassessed" video without treating it as a bad score', async () => {
    const video = makeVideo({
      status: 'unassessed',
      score: null,
      summary: 'This creative could not be assessed.',
    })
    fetchBatchResultsMock.mockResolvedValue(makeBatch({ totalCount: 1, complete: true, videos: [video] }))

    render(<ResultPage />)

    await waitFor(() => expect(screen.getByText('Could not assess')).toBeInTheDocument())
    expect(screen.getByText('—')).toBeInTheDocument() // NO_VALUE, not "0"
  })
})

describe('ResultPage — export', () => {
  it('disables the button and shows "Preparing PDF…" while exporting, then re-enables', async () => {
    fetchBatchResultsMock.mockResolvedValue(makeBatch({ totalCount: 1, complete: true, videos: [makeVideo()] }))
    let resolveDownload: () => void = () => {}
    downloadReportMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDownload = resolve
      }),
    )

    render(<ResultPage />)
    await waitFor(() => expect(screen.getByText('Your results are ready.')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Export Report/i }))

    const button = screen.getByRole('button', { name: /Preparing PDF/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    resolveDownload()
    await waitFor(() => expect(screen.getByRole('button', { name: /Export Report/i })).toBeEnabled())
  })

  it('shows the error inline next to the button without losing the results on failure', async () => {
    const video = makeVideo()
    fetchBatchResultsMock.mockResolvedValue(makeBatch({ totalCount: 1, complete: true, videos: [video] }))
    downloadReportMock.mockRejectedValueOnce(new Error('Could not build the PDF'))

    render(<ResultPage />)
    await waitFor(() => expect(screen.getByText('Your results are ready.')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Export Report/i }))

    await waitFor(() => expect(screen.getByText('Could not build the PDF')).toBeInTheDocument())
    expect(screen.getByText('Your results are ready.')).toBeInTheDocument()
    expect(downloadReportMock).toHaveBeenCalledWith(expect.objectContaining({ videos: [video] }), 'batch-1')
  })
})

describe('ResultPage — cleanup', () => {
  it('does not warn about updating state after unmounting mid-poll', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveFetch: (value: BatchResults) => void = () => {}
    fetchBatchResultsMock.mockReturnValue(
      new Promise<BatchResults>((resolve) => {
        resolveFetch = resolve
      }),
    )

    const { unmount } = render(<ResultPage />)
    unmount()
    resolveFetch(makeBatch({ totalCount: 0 }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
