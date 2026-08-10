import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BatchResults } from '../lib/results'
import ResultPage from './ResultPage'

const resultMocks = vi.hoisted(() => ({
  fetchBatchResults: vi.fn(),
  retryAdCreative: vi.fn(),
  retryReview: vi.fn(),
  deleteReview: vi.fn(),
}))

vi.mock('../lib/results', () => ({ fetchBatchResults: resultMocks.fetchBatchResults }))
vi.mock('../lib/reviews', () => ({
  retryAdCreative: resultMocks.retryAdCreative,
  retryReview: resultMocks.retryReview,
  deleteReview: resultMocks.deleteReview,
}))
vi.mock('../lib/downloadReport', () => ({ downloadReport: vi.fn() }))

function interruptedReview(overrides: Partial<BatchResults> = {}): BatchResults {
  return {
    videos: [{}] as BatchResults['videos'],
    pending: [
      { requestId: 'failed-creative', name: 'failed.mp4' },
      { requestId: 'active-creative', name: 'active.mp4' },
    ],
    totalCount: 3,
    complete: false,
    failedCount: 1,
    failedRequestIds: ['failed-creative'],
    reviewStatus: 'partially_failed',
    ...overrides,
  }
}

/** Render both the source and destination routes exercised by a Review Retry. */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/result/review-1']}>
      <Routes>
        <Route path="result/retry-1" element={<p>Focused retry route</p>} />
        <Route path="result/:batchId" element={<ResultPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  resultMocks.retryAdCreative.mockResolvedValue('retry-1')
  resultMocks.retryReview.mockResolvedValue('retry-all')
  resultMocks.deleteReview.mockResolvedValue(undefined)
})

describe('ResultPage interrupted Review Requests', () => {
  it('keeps polling when one Ad Creative failed but another remains active', async () => {
    resultMocks.fetchBatchResults.mockResolvedValue(
      interruptedReview({ reviewStatus: 'processing' }),
    )

    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Reviewing your ad creatives...' }),
    ).toBeVisible()
    expect(screen.queryByText('Review interrupted')).not.toBeInTheDocument()
  })

  it('retries only the selected terminally failed Ad Creative', async () => {
    const user = userEvent.setup()
    resultMocks.fetchBatchResults.mockResolvedValue(interruptedReview())

    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Retry this creative' }))

    expect(resultMocks.retryAdCreative).toHaveBeenCalledWith('review-1', 'failed-creative')
    expect(await screen.findByText('Focused retry route')).toBeVisible()
  })
})
