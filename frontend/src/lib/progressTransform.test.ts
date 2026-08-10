import { describe, expect, it } from 'vitest'
import {
  EVALUATORS,
  buildBatchProgress,
  buildVideoProgress,
  isFatalMediaFailure,
  rollUpStatus,
} from './progressTransform'
import type { ProgressRequestRow } from './progressTransform'
import type { ProgressUnit, UnitStatus, VideoProgress } from '../types/progress'

function requestRow(overrides: Partial<ProgressRequestRow> = {}): ProgressRequestRow {
  return {
    request_id: 'req-1',
    video_storage_paths: ['user-1/batch-1/video/req-1/ad.mp4'],
    media_processing_status: null,
    agents_triggered_at: null,
    evaluation_completion_status: null,
    ...overrides,
  }
}

function unit(status: UnitStatus, weight = 1): ProgressUnit {
  return { key: `u-${status}-${weight}`, label: status, weight, status, detail: null }
}

/** All seven evaluators reporting, as the DB would return them. */
function allAgents(requestId = 'req-1') {
  return EVALUATORS.map((evaluator) => ({ request_id: requestId, agent: evaluator.key }))
}

function unitFor(video: VideoProgress, unitKey: string) {
  const found = video.stages
    .flatMap((stage) => stage.units)
    .find((candidate) => candidate.key === unitKey)
  if (found === undefined) throw new Error(`no unit ${unitKey}`)
  return found
}

/** The seven evaluator units of one video, in declaration order. */
function evaluatorUnits(video: VideoProgress) {
  return EVALUATORS.map((evaluator) => unitFor(video, evaluator.key))
}

function build(row: ProgressRequestRow, agents: string[] = [], scored = false) {
  return buildVideoProgress(row, new Set(agents), scored)
}

// ---- the distinction the whole feature turns on --------------------------

describe('isFatalMediaFailure', () => {
  // Migration 044 fires the agents once every video_processing row has left
  // 'processing', success OR error. So a failed media stage that still handed
  // off is degraded, not dead, and the user still gets a score.
  it('is not fatal when the agents were dispatched anyway', () => {
    expect(
      isFatalMediaFailure(
        requestRow({
          media_processing_status: 'failed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
      ),
    ).toBe(false)
  })

  it('is fatal when the run stopped before the handoff', () => {
    expect(
      isFatalMediaFailure(
        requestRow({ media_processing_status: 'failed', agents_triggered_at: null }),
      ),
    ).toBe(true)
  })

  it('is not fatal while the job is merely still running', () => {
    expect(isFatalMediaFailure(requestRow({ media_processing_status: 'processing' }))).toBe(false)
  })
})

describe('media unit', () => {
  it('is queued before the worker picks the job up', () => {
    const media = unitFor(build(requestRow()), 'media')

    expect(media.status).toBe('queued')
    expect(media.detail).toBeNull()
  })

  it('is queued on the pending status too', () => {
    expect(unitFor(build(requestRow({ media_processing_status: 'pending' })), 'media').status).toBe(
      'queued',
    )
  })

  it('is processing once the worker starts', () => {
    expect(
      unitFor(build(requestRow({ media_processing_status: 'processing' })), 'media').status,
    ).toBe('processing')
  })

  // The worker only writes 'completed' when nothing errored, so a run with one
  // failed analyzer sits on 'processing' across retries with its analysis
  // already final and the agents away. Waiting for 'completed' would stall.
  it('counts as done when the agents were dispatched, even on processing', () => {
    const media = unitFor(
      build(
        requestRow({
          media_processing_status: 'processing',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
      ),
      'media',
    )

    expect(media.status).toBe('success')
  })

  it('is success when the worker completes cleanly', () => {
    expect(
      unitFor(build(requestRow({ media_processing_status: 'completed' })), 'media').status,
    ).toBe('success')
  })

  it('warns rather than errors on a degraded run with safe display copy', () => {
    const media = unitFor(
      build(
        requestRow({
          media_processing_status: 'failed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
      ),
      'media',
    )

    expect(media.status).toBe('warning')
    expect(media.detail).toBe(
      'Some video analysis could not be completed, so the review continued with partial data.',
    )
  })

  it('errors when the run stopped with safe actionable copy', () => {
    const media = unitFor(
      build(requestRow({ media_processing_status: 'failed' })),
      'media',
    )

    expect(media.status).toBe('error')
    expect(media.detail).toBe(
      'We could not process this video. Check that the file is a supported, playable video.',
    )
  })

  // Migration 042 already widened one of these CHECK constraints once. An
  // unrecognized value must degrade, not throw.
  it('treats an unknown future status as queued', () => {
    expect(
      unitFor(build(requestRow({ media_processing_status: 'skipped' })), 'media').status,
    ).toBe('queued')
  })
})

describe('evaluation units', () => {
  it('has one unit per evaluator, all queued before the handoff', () => {
    const units = evaluatorUnits(build(requestRow({ media_processing_status: 'processing' })))

    expect(units).toHaveLength(7)
    expect(units.every((candidate) => candidate.status === 'queued')).toBe(true)
  })

  // 044 dispatches all seven in one loop, so after the handoff the ones without
  // rows are genuinely in flight rather than waiting their turn.
  it('marks unreported evaluators as processing once dispatched', () => {
    const video = build(
      requestRow({
        media_processing_status: 'completed',
        agents_triggered_at: '2026-08-10T12:00:00Z',
      }),
      ['claims_accuracy'],
    )

    expect(unitFor(video, 'claims_accuracy').status).toBe('success')
    expect(unitFor(video, 'brand_alignment').status).toBe('processing')
  })

  // The keys are agent names, not dimension ids. `storyline_brief` and
  // `visual_asset_quality` are dimensions; using them here would silently never
  // tick. This test is the guard on that.
  it('keys on agent names, not dimension ids', () => {
    expect(EVALUATORS.map((evaluator) => evaluator.key)).toEqual([
      'claims_accuracy',
      'brief_alignment',
      'storyline_clarity',
      'product_representation',
      'brand_alignment',
      'cta_effectiveness',
      'visual_quality',
    ])
  })

  it('marks every evaluator skipped when the video died first', () => {
    const units = evaluatorUnits(build(requestRow({ media_processing_status: 'failed' })))

    expect(
      units.every(
        (candidate) =>
          candidate.status === 'error' && candidate.detail === 'Skipped — video processing failed',
      ),
    ).toBe(true)
  })
})

describe('scoring unit', () => {
  it('is queued until evaluation completion is scheduled', () => {
    expect(unitFor(build(requestRow()), 'scoring').status).toBe('queued')
  })

  it('is processing while completion is pending or running', () => {
    expect(
      unitFor(build(requestRow({ evaluation_completion_status: 'pending' })), 'scoring')
        .status,
    ).toBe('processing')
    expect(
      unitFor(
        build(requestRow({ evaluation_completion_status: 'processing' })),
        'scoring',
      ).status,
    ).toBe('processing')
  })

  it('is success once the score row exists', () => {
    expect(unitFor(build(requestRow(), [], true), 'scoring').status).toBe('success')
  })

  // complete-evaluation only marks completed after both projections succeeded,
  // so accepting it avoids a flicker when the two queries straddle that write.
  it('is success on a completed status even before the row is visible', () => {
    expect(
      unitFor(
        build(requestRow({ evaluation_completion_status: 'completed' }), [], false),
        'scoring',
      ).status,
    ).toBe('success')
  })

  it('errors with safe display copy when completion failed', () => {
    const scoring = unitFor(
      build(
        requestRow({ evaluation_completion_status: 'failed' }),
      ),
      'scoring',
    )

    expect(scoring.status).toBe('error')
    expect(scoring.detail).toBe(
      'We could not finish scoring this creative. No score is available for this review.',
    )
  })
})

describe('rollUpStatus', () => {
  it('reports error if any unit failed, whatever else finished', () => {
    expect(rollUpStatus([unit('success'), unit('error'), unit('processing')])).toBe('error')
  })

  // A green tick over a finished-but-degraded stage would hide the warning
  // sitting inside it.
  it('reports warning when everything is terminal but one degraded', () => {
    expect(rollUpStatus([unit('success'), unit('warning')])).toBe('warning')
  })

  it('reports success only when every unit succeeded', () => {
    expect(rollUpStatus([unit('success'), unit('success')])).toBe('success')
  })

  it('reports processing once anything has moved', () => {
    expect(rollUpStatus([unit('success'), unit('queued')])).toBe('processing')
    expect(rollUpStatus([unit('processing'), unit('queued')])).toBe('processing')
  })

  it('reports queued when nothing has started', () => {
    expect(rollUpStatus([unit('queued'), unit('queued')])).toBe('queued')
    expect(rollUpStatus([])).toBe('queued')
  })
})

// Weights are 5 (media) + 1x7 (evaluators) + 1 (scoring) = 13. If these numbers
// drift, the weights changed and this table is the record of what they were.
describe('weighted percentage', () => {
  it('walks a healthy run 0 -> 38 -> 92 -> 100', () => {
    expect(build(requestRow()).pct).toBe(0)

    expect(build(requestRow({ media_processing_status: 'completed' })).pct).toBe(38)

    expect(
      build(
        requestRow({
          media_processing_status: 'completed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
        EVALUATORS.map((evaluator) => evaluator.key),
      ).pct,
    ).toBe(92)

    expect(
      build(
        requestRow({
          media_processing_status: 'completed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
        EVALUATORS.map((evaluator) => evaluator.key),
        true,
      ).pct,
    ).toBe(100)
  })

  // Every unit is terminal ('error' counts), so the page must be free to move on
  // rather than spinning until the ten-minute timeout.
  it('reaches 100 and done on a fatally failed video', () => {
    const video = build(requestRow({ media_processing_status: 'failed' }))

    expect(video.pct).toBe(100)
    expect(video.isDone).toBe(true)
    expect(video.fatalError).toBe(
      'We could not process this video. Check that the file is a supported, playable video.',
    )
  })

  it('reports no fatal error on a degraded run that still scored', () => {
    const video = build(
      requestRow({
        media_processing_status: 'failed',
        agents_triggered_at: '2026-08-10T12:00:00Z',
      }),
      EVALUATORS.map((evaluator) => evaluator.key),
      true,
    )

    expect(video.fatalError).toBeNull()
    expect(video.pct).toBe(100)
    expect(video.isDone).toBe(true)
  })

  it('treats a failed scoring stage as fatal — there will be no result', () => {
    const video = build(
      requestRow({
        media_processing_status: 'completed',
        agents_triggered_at: '2026-08-10T12:00:00Z',
        evaluation_completion_status: 'failed',
      }),
      EVALUATORS.map((evaluator) => evaluator.key),
    )

    expect(video.fatalError).toBe(
      'We could not finish scoring this creative. No score is available for this review.',
    )
    expect(video.isDone).toBe(true)
  })
})

describe('buildBatchProgress', () => {
  it('is not done for a batch id that matched nothing', () => {
    const batch = buildBatchProgress({ requests: [], agents: [], scored: [] })

    expect(batch.videos).toHaveLength(0)
    expect(batch.isDone).toBe(false)
    expect(batch.pct).toBe(0)
  })

  it('is done only when every video is', () => {
    const batch = buildBatchProgress({
      requests: [
        requestRow({
          request_id: 'req-1',
          media_processing_status: 'completed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/b.mp4'],
          media_processing_status: 'processing',
        }),
      ],
      agents: allAgents('req-1'),
      scored: [{ request_id: 'req-1' }],
    })

    expect(batch.videos.map((video) => video.pct)).toEqual([100, 0])
    expect(batch.isDone).toBe(false)
  })

  it('weights the batch bar across every video, not per video', () => {
    // One video finished (13 of 13), one untouched (0 of 13) => 13/26.
    const batch = buildBatchProgress({
      requests: [
        requestRow({
          request_id: 'req-1',
          media_processing_status: 'completed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/b.mp4'],
        }),
      ],
      agents: allAgents('req-1'),
      scored: [{ request_id: 'req-1' }],
    })

    expect(batch.pct).toBe(50)
  })

  // Math.round used to let this read 100: one outstanding unit is 1/208 of a
  // 16-video batch's weight, which is under the half-percent rounding threshold.
  // "100% complete" next to a spinner is the kind of thing that discredits the
  // whole bar, so percent() floors.
  it('never reads 100 while work is outstanding, however large the batch', () => {
    const done = Array.from({ length: 15 }, (_, index) =>
      requestRow({
        request_id: `req-${index}`,
        video_storage_paths: [`u/b/video/req-${index}/v${index}.mp4`],
        media_processing_status: 'completed',
        agents_triggered_at: '2026-08-10T12:00:00Z',
        evaluation_completion_status: 'completed',
      }),
    )
    // Everything but this one's scoring row — a single unit of 208.
    const lastRequest = requestRow({
      request_id: 'req-last',
      video_storage_paths: ['u/b/video/req-last/z.mp4'],
      media_processing_status: 'completed',
      agents_triggered_at: '2026-08-10T12:00:00Z',
    })

    const batch = buildBatchProgress({
      requests: [...done, lastRequest],
      agents: [...done, lastRequest].flatMap((request) => allAgents(request.request_id)),
      scored: done.map((request) => ({ request_id: request.request_id })),
    })

    expect(batch.isDone).toBe(false)
    expect(batch.pct).toBe(99)
  })

  it('collects only the videos whose pipeline stopped', () => {
    const batch = buildBatchProgress({
      requests: [
        requestRow({
          request_id: 'req-1',
          media_processing_status: 'failed',
        }),
        requestRow({
          request_id: 'req-2',
          video_storage_paths: ['user-1/batch-1/video/req-2/b.mp4'],
          media_processing_status: 'failed',
          agents_triggered_at: '2026-08-10T12:00:00Z',
        }),
      ],
      agents: allAgents('req-2'),
      scored: [{ request_id: 'req-2' }],
    })

    expect(batch.failed.map((video) => video.requestId)).toEqual(['req-1'])
    expect(batch.failed[0].fatalError).toBe(
      'We could not process this video. Check that the file is a supported, playable video.',
    )
  })

  // Matches assembleVideoResults, so a video holds the same position in the
  // loading list and in the ranking that replaces it.
  it('sorts videos by filename', () => {
    const batch = buildBatchProgress({
      requests: [
        requestRow({ request_id: 'req-1', video_storage_paths: ['user-1/b/video/req-1/z.mp4'] }),
        requestRow({ request_id: 'req-2', video_storage_paths: ['user-1/b/video/req-2/a.mp4'] }),
      ],
      agents: [],
      scored: [],
    })

    expect(batch.videos.map((video) => video.name)).toEqual(['a.mp4', 'z.mp4'])
  })

  it('does not leak one video s evaluators into another', () => {
    const batch = buildBatchProgress({
      requests: [
        requestRow({ request_id: 'req-1', video_storage_paths: ['user-1/b/video/req-1/a.mp4'] }),
        requestRow({ request_id: 'req-2', video_storage_paths: ['user-1/b/video/req-2/b.mp4'] }),
      ],
      agents: allAgents('req-1'),
      scored: [],
    })

    const [first, second] = batch.videos
    expect(unitFor(first, 'claims_accuracy').status).toBe('success')
    expect(unitFor(second, 'claims_accuracy').status).toBe('queued')
  })
})
