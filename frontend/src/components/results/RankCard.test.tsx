import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RankCard from './RankCard'
import type { VideoResult } from '../../types/results'

function video(overrides: Partial<VideoResult> = {}): VideoResult {
  return {
    requestId: 'req-1',
    rank: 1,
    name: 'Video_1.mp4',
    videoPath: null,
    score: 91,
    status: 'ready',
    thumb: 'bg-violet-100 text-violet-500',
    metrics: [],
    summary: 'No issues found.',
    issues: [],
    ...overrides,
  }
}

describe('RankCard', () => {
  it('shows the score and status for a scored video', () => {
    render(<RankCard video={video()} selected={false} onSelect={vi.fn()} />)

    expect(screen.getByText('91')).toBeVisible()
    expect(screen.getByText('Ready to Ship')).toBeVisible()
  })

  it('shows a dash rather than a number when the video was not assessed', () => {
    render(
      <RankCard
        video={video({ score: null, status: 'unassessed', rank: 4 })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('—')).toBeVisible()
    expect(screen.getByText('Could not assess')).toBeVisible()
  })

  it('withholds the winner badge from an unscored video ranked first', () => {
    // Only reachable when every video in the batch failed to assess. Awarding a
    // green "best in batch" badge to something never scored would be misleading.
    const { container } = render(
      <RankCard
        video={video({ score: null, status: 'unassessed', rank: 1 })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )

    expect(container.querySelector('.bg-green-500')).toBeNull()
  })

  it('gives the winner badge to a real top scorer', () => {
    const { container } = render(
      <RankCard video={video({ rank: 1, score: 91 })} selected={false} onSelect={vi.fn()} />,
    )

    expect(container.querySelector('.bg-green-500')).not.toBeNull()
  })
})
