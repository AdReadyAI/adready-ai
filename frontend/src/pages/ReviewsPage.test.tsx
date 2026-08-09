import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewsPage from './ReviewsPage'

const reviewMocks = vi.hoisted(() => ({
  listReviews: vi.fn(),
  retryReview: vi.fn(),
  deleteReview: vi.fn(),
}))

vi.mock('../lib/reviews', () => reviewMocks)

const failedReview = {
  id: 'review-1',
  retryOfId: null,
  createdAt: '2026-08-08T15:30:00.000Z',
  creativeCount: 2,
  creativeNames: ['launch.mp4', 'cutdown.mp4'],
  scoredCount: 1,
  failedCount: 1,
  status: 'partially_failed' as const,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reviews']}>
      <Routes>
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="result/:batchId" element={<p>Retry result route</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  reviewMocks.listReviews.mockResolvedValue([failedReview])
  reviewMocks.retryReview.mockResolvedValue('retry-1')
  reviewMocks.deleteReview.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('ReviewsPage', () => {
  it('shows previous creatives and partial failure context', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Previous reviews' })).toBeVisible()
    expect(screen.getByText('Partially failed')).toBeVisible()
    expect(screen.getByText('2 creatives · 1 scored · 1 failed')).toBeVisible()
    expect(screen.getByText('launch.mp4, cutdown.mp4')).toBeVisible()
  })

  it('starts a complete retry and opens the new result route', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Retry all' }))

    expect(reviewMocks.retryReview).toHaveBeenCalledWith('review-1')
    expect(await screen.findByText('Retry result route')).toBeVisible()
  })

  it('confirms deletion and removes the review from history', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(reviewMocks.deleteReview).toHaveBeenCalledWith('review-1')
    expect(await screen.findByText('No reviews yet')).toBeVisible()
  })

  it('keeps a review when deletion is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(reviewMocks.deleteReview).not.toHaveBeenCalled()
    expect(screen.getByText('launch.mp4, cutdown.mp4')).toBeVisible()
  })
})
