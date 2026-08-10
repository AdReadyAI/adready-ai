// Covers the page's gating: which of the states renders when, and — the part
// that is easy to regress — that the heavy results query fires exactly once,
// when the pipeline finishes, rather than on every poll.
//
// `useRequestProgress` is mocked so the states can be driven directly; its own
// polling behaviour is covered in lib/useRequestProgress.test.ts.

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResultPage from './ResultPage'
import { EVALUATORS, buildBatchProgress } from '../lib/progressTransform'
import type { ProgressRequestRow } from '../lib/progressTransform'
import type { BatchResults } from '../lib/resultsTransform'
import type { VideoResult } from '../types/results'
import type { RequestProgressState } from '../lib/useRequestProgress'

const {
  deleteReviewRequestMock,
  fetchBatchResultsMock,
  navigateMock,
  paramsRef,
  progressRef,
  retryMock,
} = vi.hoisted(() => ({
  deleteReviewRequestMock: vi.fn(),
  fetchBatchResultsMock: vi.fn(),
  navigateMock: vi.fn(),
  paramsRef: { current: {} as { batchId?: string } },
  progressRef: { current: {} as RequestProgressState },
  retryMock: vi.fn(),
}))

vi.mock('../lib/results', () => ({ fetchBatchResults: fetchBatchResultsMock }))
vi.mock('../lib/downloadReport', () => ({ downloadReport: vi.fn() }))
vi.mock('../lib/reviewRequests', () => ({
  deleteReviewRequest: deleteReviewRequestMock,
}))
vi.mock('../lib/useRequestProgress', () => ({ useRequestProgress: () => progressRef.current }))

// Signs a playback URL against the real Supabase client — mocked out entirely so
// importing ResultPage doesn't crash on missing env vars.
vi.mock('../lib/useSignedVideoUrl', () => ({ useSignedVideoUrl: () => null }))

vi.mock('react-router-dom', () => ({
  useParams: () => paramsRef.current,
  useNavigate: () => navigateMock,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))

function requestRow(overrides: Partial<ProgressRequestRow> = {}): ProgressRequestRow {
  return {
    request_id: 'req-1',
    video_storage_paths: ['user-1/batch-1/video/req-1/ad.mp4'],
    media_processing_status: null,
    media_processing_failure_code: null,
    agents_triggered_at: null,
    evaluation_completion_status: null,
    ...overrides,
  }
}

/**
 * `scored` doubles as the list of requests whose evaluators have all reported —
 * a request cannot have a score row without them, since complete-evaluation only
 * runs once every canonical metric exists.
 */
function progressState(
  rows: ProgressRequestRow[],
  overrides: Partial<RequestProgressState> = {},
  scored: string[] = [],
): RequestProgressState {
  return {
    progress: buildBatchProgress({
      requests: rows,
      agents: scored.flatMap((request_id) =>
        EVALUATORS.map((evaluator) => ({ request_id, agent: evaluator.key })),
      ),
      scored: scored.map((request_id) => ({ request_id })),
    }),
    error: null,
    timedOut: false,
    retry: retryMock,
    ...overrides,
  }
}

/** A request row in every terminal state, so the batch reads as finished. */
function finishedRow(overrides: Partial<ProgressRequestRow> = {}): ProgressRequestRow {
  return requestRow({
    media_processing_status: 'completed',
    agents_triggered_at: '2026-08-10T12:00:00Z',
    evaluation_completion_status: 'completed',
    ...overrides,
  })
}

function makeVideo(overrides: Partial<VideoResult> = {}): VideoResult {
  return {
    requestId: 'req-1',
    rank: 1,
    name: 'ad.mp4',
    videoPath: 'user-1/batch-1/video/req-1/ad.mp4',
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
  return { videos: [], pending: [], totalCount: 0, complete: false, ...overrides }
}

beforeEach(() => {
  fetchBatchResultsMock.mockReset()
  navigateMock.mockReset()
  retryMock.mockReset()
  deleteReviewRequestMock.mockReset()
  paramsRef.current = { batchId: 'batch-1' }
  progressRef.current = progressState([requestRow()])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ResultPage gating', () => {
  it('needs a batch id', () => {
    paramsRef.current = {}
    progressRef.current = { progress: null, error: null, timedOut: false, retry: retryMock }

    render(<ResultPage />)

    expect(screen.getByText('No batch selected')).toBeVisible()
    expect(fetchBatchResultsMock).not.toHaveBeenCalled()
  })

  it('shows a loading message before the first poll resolves', () => {
    progressRef.current = { progress: null, error: null, timedOut: false, retry: retryMock }

    render(<ResultPage />)

    expect(screen.getByText('Loading your results…')).toBeVisible()
  })

  // A poll error with progress already on screen is only a banner — the run
  // continues whether or not we can watch it. With nothing at all, it is the page.
  it('shows a full error only when it has nothing to show', () => {
    progressRef.current = {
      progress: null,
      error: 'network down',
      timedOut: false,
      retry: retryMock,
    }

    render(<ResultPage />)

    expect(screen.getByText('Could not load your review')).toBeVisible()
    expect(screen.getByText('network down')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  // Unknown batch and someone else's batch are indistinguishable by design: RLS
  // returns an empty set rather than revealing that a batch exists.
  it('reports an empty batch as not found', () => {
    progressRef.current = progressState([])

    render(<ResultPage />)

    expect(screen.getByText('Batch not found')).toBeVisible()
  })

  it('shows live progress while the pipeline runs, and does not query results', () => {
    progressRef.current = progressState([requestRow({ media_processing_status: 'processing' })])

    render(<ResultPage />)

    expect(screen.getByText('Reviewing your ad creatives...')).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toBeVisible()
    expect(fetchBatchResultsMock).not.toHaveBeenCalled()
  })

  it('queries results once the pipeline finishes, and renders them', async () => {
    progressRef.current = progressState([finishedRow()], {}, ['req-1'])
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({ totalCount: 1, complete: true, videos: [makeVideo()] }),
    )

    render(<ResultPage />)

    expect(await screen.findByText('Your results are ready.')).toBeVisible()
    expect(fetchBatchResultsMock).toHaveBeenCalledExactlyOnceWith('batch-1')
  })

  // The hook hands back a fresh object every poll; depending on it rather than on
  // the boolean would re-fire this query on every tick of a finished batch.
  it('does not re-query results when progress re-renders unchanged', async () => {
    progressRef.current = progressState([finishedRow()], {}, ['req-1'])
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({ totalCount: 1, complete: true, videos: [makeVideo()] }),
    )

    const { rerender } = render(<ResultPage />)
    expect(await screen.findByText('Your results are ready.')).toBeVisible()

    progressRef.current = progressState([finishedRow()], {}, ['req-1'])
    rerender(<ResultPage />)

    expect(fetchBatchResultsMock).toHaveBeenCalledOnce()
  })

  // React Router reuses this component when only the :batchId param changes, so
  // state survives the navigation and a render always precedes the effects that
  // react to it. Without the batch tag on `loaded` there is a window — one full
  // results round trip — where batch A's ranking renders under batch B's URL.
  it('never shows the previous batch results after switching batch', async () => {
    progressRef.current = progressState([finishedRow()], {}, ['req-1'])
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({ totalCount: 1, complete: true, videos: [makeVideo({ name: 'batch-a.mp4' })] }),
    )

    const { rerender } = render(<ResultPage />)
    // Scoped to the heading: the filename also appears on the ranking card.
    expect(await screen.findByRole('heading', { name: 'batch-a.mp4' })).toBeVisible()

    // Switch to a second batch that is also finished, but whose results query is
    // still in flight — the exact moment the old data used to leak through.
    let resolveSecond: (value: BatchResults) => void = () => {}
    fetchBatchResultsMock.mockReturnValue(
      new Promise<BatchResults>((resolve) => {
        resolveSecond = resolve
      }),
    )
    paramsRef.current = { batchId: 'batch-2' }
    progressRef.current = progressState([finishedRow({ request_id: 'req-2' })], {}, ['req-2'])
    rerender(<ResultPage />)

    expect(screen.queryByRole('heading', { name: 'batch-a.mp4' })).not.toBeInTheDocument()
    expect(screen.getByText('Loading your results…')).toBeVisible()

    resolveSecond(
      makeBatch({
        totalCount: 1,
        complete: true,
        videos: [makeVideo({ requestId: 'req-2', name: 'batch-b.mp4' })],
      }),
    )
    expect(await screen.findByRole('heading', { name: 'batch-b.mp4' })).toBeVisible()
  })
})

describe('ResultPage failures', () => {
  it('keeps the Review Request active while any Ad Creative is still processing', () => {
    progressRef.current = progressState([
      requestRow({ media_processing_status: 'processing' }),
      requestRow({
        request_id: 'req-2',
        media_processing_status: 'failed',
      }),
    ])

    render(<ResultPage />)

    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toBeVisible()
    expect(screen.queryByText('Review Request failed')).not.toBeInTheDocument()
    expect(fetchBatchResultsMock).not.toHaveBeenCalled()
  })

  it('shows a safe reason for each failed Ad Creative without offering a retry', async () => {
    progressRef.current = progressState(
      [
        finishedRow(),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/failed.mp4'],
          media_processing_status: 'failed',
        }),
      ],
      {},
      ['req-1'],
    )
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({
        videos: [makeVideo()],
        pending: [{ requestId: 'req-2', name: 'failed.mp4' }],
        totalCount: 2,
        failedCount: 1,
        failedRequestIds: ['req-2'],
        reviewRequestStatus: 'partially_failed',
      }),
    )

    render(<ResultPage />)

    expect(await screen.findByText('failed.mp4')).toBeVisible()
    expect(
      screen.getByText(/Automated video processing could not finish/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  // The user submitted two videos and got one back, so the omitted creative and
  // its safe terminal explanation must remain visible above the ranking.
  it('names a video whose pipeline stopped, above the ranking', async () => {
    progressRef.current = progressState(
      [
        finishedRow(),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/b.mp4'],
          media_processing_status: 'failed',
        }),
      ],
      {},
      ['req-1'],
    )
    fetchBatchResultsMock.mockResolvedValue(
      makeBatch({ totalCount: 2, complete: false, videos: [makeVideo()] }),
    )

    render(<ResultPage />)

    expect(await screen.findByText('1 video could not be reviewed')).toBeVisible()
    expect(screen.getByText('b.mp4')).toBeVisible()
    expect(screen.getByText(/Automated video processing could not finish/)).toBeVisible()
    expect(screen.getByText('Your results are ready.')).toBeVisible()
  })

  it('explains a batch where every video died', async () => {
    progressRef.current = progressState([
      requestRow({ media_processing_status: 'failed' }),
    ])
    fetchBatchResultsMock.mockResolvedValue(makeBatch({ totalCount: 1 }))

    render(<ResultPage />)

    expect(await screen.findByText('No results to show')).toBeVisible()
    expect(screen.getByText(/Automated video processing could not finish/)).toBeVisible()
  })

  it('surfaces a failure of the results query itself', async () => {
    progressRef.current = progressState([finishedRow()], {}, ['req-1'])
    fetchBatchResultsMock.mockRejectedValue(new Error('results unavailable'))

    render(<ResultPage />)

    expect(await screen.findByText('Could not load your results')).toBeVisible()
    expect(screen.getByText('results unavailable')).toBeVisible()
  })
})
