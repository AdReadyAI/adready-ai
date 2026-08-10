// Built from real transform output rather than hand-written props, so a change
// to how a status is derived shows up here instead of passing against fixtures
// that no longer resemble what the page receives.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ProcessingView from './ProcessingView'
import { EVALUATORS, buildBatchProgress } from '../../lib/progressTransform'
import type { ProgressRequestRow } from '../../lib/progressTransform'

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

function progressFor(rows: ProgressRequestRow[], agents: string[] = [], scored: string[] = []) {
  return buildBatchProgress({
    requests: rows,
    agents: agents.map((agent) => ({ request_id: 'req-1', agent })),
    scored: scored.map((request_id) => ({ request_id })),
  })
}

function renderView(
  progress: ReturnType<typeof progressFor>,
  overrides: { error?: string | null; timedOut?: boolean; onRetry?: () => void } = {},
) {
  const onRetry = overrides.onRetry ?? vi.fn()
  render(
    <ProcessingView
      progress={progress}
      error={overrides.error ?? null}
      timedOut={overrides.timedOut ?? false}
      onRetry={onRetry}
    />,
  )
  return onRetry
}

/** Scopes queries to one video's card, found via the filename's title attribute. */
function tileFor(name: string) {
  const card = screen.getByTitle(name).closest<HTMLElement>('div.rounded-2xl')
  if (!card) throw new Error(`no card for ${name}`)
  return within(card)
}

describe('ProcessingView layout', () => {
  it('shows the overall percentage and one tile per video', () => {
    renderView(
      progressFor([
        requestRow({ media_processing_status: 'completed' }),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/b.mp4'],
        }),
      ]),
    )

    expect(screen.getByText('Reviewing your ad creatives...')).toBeVisible()
    expect(screen.getByTitle('ad.mp4')).toBeVisible()
    expect(screen.getByTitle('b.mp4')).toBeVisible()

    // 5 of 26 weighted units done.
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toHaveAttribute(
      'aria-valuenow',
      '19',
    )
    expect(screen.getByText('19% complete')).toBeVisible()
  })

  it('names every stage and every evaluator on a card', () => {
    renderView(progressFor([requestRow()]))

    expect(screen.getByText('Processing your video')).toBeVisible()
    expect(screen.getByText('Preparing and analyzing')).toBeVisible()
    expect(screen.getByText('Reviewing your creative')).toBeVisible()
    expect(screen.getByText('Scoring')).toBeVisible()
    expect(screen.getByText('Building your scorecard')).toBeVisible()

    for (const evaluator of EVALUATORS) {
      expect(screen.getByText(evaluator.label)).toBeVisible()
    }
  })

  // A batch-level rollup was tried and it lies: one failed video turns every
  // row red while the others are running fine. Each video owns its checklist.
  it('gives every video its own checklist', () => {
    renderView(
      progressFor([
        requestRow({ media_processing_status: 'completed' }),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/b.mp4'],
          media_processing_status: 'failed',
        }),
      ]),
    )

    expect(screen.getAllByText('Claim accuracy')).toHaveLength(2)
    // The healthy video's own row is untouched by its neighbour's failure.
    expect(tileFor('ad.mp4').getByText('In Progress')).toBeVisible()
    expect(tileFor('b.mp4').getByText('Failed')).toBeVisible()
  })

  it('gives each video the same tint the ranking card will use', () => {
    const progress = progressFor([
      requestRow({ video_storage_paths: ['user-1/b/video/req-1/z.mp4'] }),
      requestRow({ request_id: 'req-2', video_storage_paths: ['user-1/b/video/req-2/a.mp4'] }),
    ])

    // Sorted by filename before tints are handed out, exactly as the results
    // view does it — so a.mp4 takes the first tint, not z.mp4.
    expect(progress.videos.map((video) => video.name)).toEqual(['a.mp4', 'z.mp4'])
    expect(progress.videos[0].thumb).toBe('bg-violet-100 text-violet-500')
  })
})

describe('ProcessingView states', () => {
  it('labels a running video In Progress', () => {
    renderView(progressFor([requestRow({ media_processing_status: 'processing' })]))

    expect(tileFor('ad.mp4').getByText('In Progress')).toBeVisible()
  })

  // The case the whole feature turns on: media failed, but the agents were
  // dispatched anyway, so this run is degraded rather than dead.
  it('reports a degraded run as a warning, not a stopped pipeline', () => {
    renderView(
      progressFor([
        requestRow({
          media_processing_status: 'failed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
      ]),
    )

    expect(
      screen.getByText(
        'Some video analysis could not be completed, so the review continued with partial data.',
      ),
    ).toBeVisible()
    expect(screen.queryByText('Processing stopped.')).not.toBeInTheDocument()
    expect(tileFor('ad.mp4').getByText('In Progress')).toBeVisible()
  })

  it('marks a stopped video Failed and shows a safe reason', () => {
    renderView(progressFor([requestRow({ media_processing_status: 'failed' })]))

    const tile = tileFor('ad.mp4')
    expect(tile.getByText('Failed')).toBeVisible()
    expect(
      tile.getByText(
        'Automated video processing could not finish, so this creative could not be reviewed.',
      ),
    ).toBeVisible()
    expect(tile.getByText('Processing stopped.')).toBeVisible()
  })

  // A poll failure is about our connection, not the run — the tiles must stay on
  // screen showing the last known state.
  it('shows a poll error as a banner without hiding progress', () => {
    renderView(progressFor([requestRow({ media_processing_status: 'processing' })]), {
      error: 'Failed to fetch',
    })

    expect(screen.getByText("We've lost contact with the server.")).toBeVisible()
    expect(screen.getByText(/Your review is still running/)).toBeVisible()
    expect(screen.getByTitle('ad.mp4')).toBeVisible()
  })

  it('offers a retry once it has given up', async () => {
    const onRetry = renderView(progressFor([requestRow()]), { timedOut: true })

    expect(screen.getByText('This is taking longer than expected.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('has no timeout or error chrome on a healthy run', () => {
    renderView(
      progressFor(
        [
          requestRow({
            media_processing_status: 'completed',
            agents_triggered_at: '2026-08-10T12:00:00Z',
          }),
        ],
        EVALUATORS.map((evaluator) => evaluator.key),
        ['req-1'],
      ),
    )

    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })
})
