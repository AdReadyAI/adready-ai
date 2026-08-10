import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewRequestsPage from './ReviewRequestsPage'

const reviewRequestMocks = vi.hoisted(() => ({
  listReviewRequests: vi.fn(),
  deleteReviewRequest: vi.fn(),
}))

vi.mock('../lib/reviewRequests', () => reviewRequestMocks)

const failedReviewRequest = {
  id: 'review-1',
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
        <Route path="reviews" element={<ReviewRequestsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  reviewRequestMocks.listReviewRequests.mockResolvedValue([failedReviewRequest])
  reviewRequestMocks.deleteReviewRequest.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('ReviewRequestsPage', () => {
  it('shows previous creatives and partial failure context', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Previous Review Requests' })).toBeVisible()
    expect(await screen.findByText('Partially failed')).toBeVisible()
    expect(screen.getByText('2 creatives · 1 scored · 1 failed')).toBeVisible()
    expect(screen.getByText('launch.mp4, cutdown.mp4')).toBeVisible()
  })

  it('confirms deletion and removes the review from history', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(window.confirm).toHaveBeenCalledOnce()
    expect(reviewRequestMocks.deleteReviewRequest).toHaveBeenCalledWith('review-1')
    expect(await screen.findByText('No reviews yet')).toBeVisible()
  })

  it('keeps a review when deletion is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(reviewRequestMocks.deleteReviewRequest).not.toHaveBeenCalled()
    expect(screen.getByText('launch.mp4, cutdown.mp4')).toBeVisible()
  })
})
