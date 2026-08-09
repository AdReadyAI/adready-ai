import { describe, expect, it } from 'vitest'
import {
  assembleVideoResults,
  buildSummary,
  isDisplaySeverity,
  normalizeTimestamp,
  parseTimestampSeconds,
  toIssues,
  toMetrics,
  toShipStatus,
  videoNameFromPaths,
  videoPathFromPaths,
} from './resultsTransform'
import type { DimensionRow, IssueRow, RequestRow, ScoreRow } from './resultsTransform'

function issueRow(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    request_id: 'req-1',
    metric_id: 'cta_clarity',
    title: 'cta_clarity',
    detail: 'CTA is too short.',
    severity: 'high',
    repair_suggestion: 'Hold the CTA for 2s.',
    video_timestamp: '0:22',
    ...overrides,
  }
}

describe('toShipStatus', () => {
  it('maps all four database values', () => {
    expect(toShipStatus('Ready')).toBe('ready')
    expect(toShipStatus('Needs Revision')).toBe('revision')
    expect(toShipStatus('High Risk')).toBe('nope')
    expect(toShipStatus('Cannot Assess')).toBe('unassessed')
  })

  it('treats an unrecognized status as unassessed rather than throwing', () => {
    expect(toShipStatus('Something New')).toBe('unassessed')
  })
})

describe('isDisplaySeverity', () => {
  it('accepts the four severities users see', () => {
    expect(isDisplaySeverity('critical')).toBe(true)
    expect(isDisplaySeverity('high')).toBe(true)
    expect(isDisplaySeverity('medium')).toBe(true)
    expect(isDisplaySeverity('low')).toBe(true)
  })

  it('rejects the two that are hidden', () => {
    expect(isDisplaySeverity('none')).toBe(false)
    expect(isDisplaySeverity('cannot_assess')).toBe(false)
  })
})

describe('normalizeTimestamp', () => {
  it('keeps a well-formed clock time', () => {
    expect(normalizeTimestamp('0:22')).toBe('0:22')
  })

  it('strips a padded minute', () => {
    expect(normalizeTimestamp('00:15')).toBe('0:15')
  })

  it('converts raw seconds', () => {
    expect(normalizeTimestamp('14.5')).toBe('0:14')
    expect(normalizeTimestamp('95')).toBe('1:35')
  })

  it('returns null for absent or blank values', () => {
    expect(normalizeTimestamp(null)).toBeNull()
    expect(normalizeTimestamp(undefined)).toBeNull()
    expect(normalizeTimestamp('   ')).toBeNull()
  })

  it('passes through an unrecognized format instead of dropping it', () => {
    expect(normalizeTimestamp('1:02:33')).toBe('1:02:33')
  })
})

describe('parseTimestampSeconds', () => {
  it('converts a clock time to seconds', () => {
    expect(parseTimestampSeconds('0:22')).toBe(22)
    expect(parseTimestampSeconds('00:15')).toBe(15)
    expect(parseTimestampSeconds('1:35')).toBe(95)
  })

  it('accepts raw seconds, flooring fractions to match the displayed label', () => {
    expect(parseTimestampSeconds('95')).toBe(95)
    // The chip reads 0:14, so seeking to 14.5 would land past the moment the
    // user was pointed at.
    expect(parseTimestampSeconds('14.5')).toBe(14)
  })

  it('returns null for absent or blank values', () => {
    expect(parseTimestampSeconds(null)).toBeNull()
    expect(parseTimestampSeconds(undefined)).toBeNull()
    expect(parseTimestampSeconds('   ')).toBeNull()
  })

  it('returns null for a format it cannot seek to', () => {
    // normalizeTimestamp still shows this one. The two disagree on purpose:
    // displayable is a weaker bar than seekable.
    expect(parseTimestampSeconds('1:02:33')).toBeNull()
    expect(normalizeTimestamp('1:02:33')).toBe('1:02:33')
  })

  it('agrees with the label normalizeTimestamp shows', () => {
    // The regression this guards: a second parser drifting from the first, so
    // the chip reads one time and the player seeks to another.
    for (const raw of ['0:22', '00:15', '14.5', '95', '100:30']) {
      const seconds = parseTimestampSeconds(raw) as number
      const minutes = Math.floor(seconds / 60)
      const remainder = seconds % 60
      const expected = `${minutes}:${remainder < 10 ? `0${remainder}` : remainder}`
      expect(normalizeTimestamp(raw)).toBe(expected)
    }
  })
})

describe('videoPathFromPaths', () => {
  it('takes the same entry the display name comes from', () => {
    const paths = ['user-1/batch-1/video/v1/Ad_Cut.mp4']
    expect(videoPathFromPaths(paths)).toBe('user-1/batch-1/video/v1/Ad_Cut.mp4')
    expect(videoNameFromPaths(paths)).toBe('Ad_Cut.mp4')
  })

  it('is null when no path was recorded', () => {
    expect(videoPathFromPaths(null)).toBeNull()
    expect(videoPathFromPaths([])).toBeNull()
  })
})

describe('toIssues', () => {
  it('drops none and cannot_assess', () => {
    const issues = toIssues([
      issueRow({ metric_id: 'a', severity: 'high' }),
      issueRow({ metric_id: 'b', severity: 'none' }),
      issueRow({ metric_id: 'c', severity: 'cannot_assess' }),
    ])

    expect(issues.map((issue) => issue.metricId)).toEqual(['a'])
  })

  it('sorts most severe first', () => {
    const issues = toIssues([
      issueRow({ metric_id: 'low_one', severity: 'low' }),
      issueRow({ metric_id: 'critical_one', severity: 'critical' }),
      issueRow({ metric_id: 'medium_one', severity: 'medium' }),
      issueRow({ metric_id: 'high_one', severity: 'high' }),
    ])

    expect(issues.map((issue) => issue.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ])
  })

  it('breaks severity ties deterministically so rows do not reshuffle', () => {
    const rows = [
      issueRow({ metric_id: 'zebra', severity: 'high' }),
      issueRow({ metric_id: 'alpha', severity: 'high' }),
    ]

    expect(toIssues(rows).map((issue) => issue.metricId)).toEqual(['alpha', 'zebra'])
    expect(toIssues([...rows].reverse()).map((issue) => issue.metricId)).toEqual([
      'alpha',
      'zebra',
    ])
  })

  it('builds a composite id, since neither column alone is unique per issue', () => {
    const issues = toIssues([
      issueRow({ request_id: 'req-9', metric_id: 'cta_clarity' }),
      issueRow({ request_id: 'req-9', metric_id: 'product_truth', severity: 'high' }),
    ])

    expect(new Set(issues.map((issue) => issue.id)).size).toBe(2)
    expect(issues.map((issue) => issue.id)).toContain('req-9_cta_clarity')
  })

  it('carries nullable columns through as null', () => {
    const [issue] = toIssues([
      issueRow({
        title: null,
        detail: null,
        repair_suggestion: null,
        video_timestamp: null,
      }),
    ])

    expect(issue.title).toBeNull()
    expect(issue.detail).toBeNull()
    expect(issue.repairText).toBeNull()
    expect(issue.timestamp).toBeNull()
    expect(issue.timestampSeconds).toBeNull()
  })

  it('exposes the timestamp as seconds for the clip player', () => {
    const [issue] = toIssues([issueRow({ video_timestamp: '1:35' })])

    expect(issue.timestamp).toBe('1:35')
    expect(issue.timestampSeconds).toBe(95)
  })

  it('keeps an unseekable timestamp visible with no seconds to seek to', () => {
    const [issue] = toIssues([issueRow({ video_timestamp: '1:02:33' })])

    expect(issue.timestamp).toBe('1:02:33')
    expect(issue.timestampSeconds).toBeNull()
  })
})

describe('toMetrics', () => {
  it('preserves a null score rather than turning it into zero', () => {
    const metrics = toMetrics([
      { request_id: 'r', dimension_id: 'brand_alignment', name: 'Brand Alignment', score: null },
    ])

    expect(metrics[0].value).toBeNull()
  })

  it('orders known dimensions and appends unknown ones', () => {
    const metrics = toMetrics([
      { request_id: 'r', dimension_id: 'future_metric', name: 'Future Metric', score: 10 },
      { request_id: 'r', dimension_id: 'cta_effectiveness', name: 'CTA Effectiveness', score: 20 },
      { request_id: 'r', dimension_id: 'claims_accuracy', name: 'Claims Accuracy', score: 30 },
    ])

    expect(metrics.map((metric) => metric.id)).toEqual([
      'claims_accuracy',
      'cta_effectiveness',
      'future_metric',
    ])
  })
})

describe('buildSummary', () => {
  it('says so plainly when a video could not be assessed', () => {
    expect(buildSummary([], 'unassessed')).toBe('This creative could not be assessed.')
  })

  it('reports a clean video', () => {
    expect(buildSummary([], 'ready')).toBe('No issues found.')
  })

  it('counts by severity, most severe first', () => {
    const issues = toIssues([
      issueRow({ metric_id: 'a', severity: 'medium' }),
      issueRow({ metric_id: 'b', severity: 'critical' }),
      issueRow({ metric_id: 'c', severity: 'medium' }),
    ])

    expect(buildSummary(issues, 'nope')).toBe('3 issues found — 1 critical, 2 medium')
  })

  it('uses the singular for one issue', () => {
    const issues = toIssues([issueRow({ severity: 'low' })])
    expect(buildSummary(issues, 'revision')).toBe('1 issue found — 1 low')
  })
})

describe('videoNameFromPaths', () => {
  it('takes the basename', () => {
    expect(videoNameFromPaths(['user/batch/video/1/Video_1.mp4'])).toBe('Video_1.mp4')
  })

  it('falls back when the path array is empty or null', () => {
    expect(videoNameFromPaths([])).toBe('Untitled video')
    expect(videoNameFromPaths(null)).toBe('Untitled video')
  })
})

describe('assembleVideoResults', () => {
  const requests: RequestRow[] = [
    { request_id: 'r1', video_storage_paths: ['u/b/Video_1.mp4'] },
    { request_id: 'r2', video_storage_paths: ['u/b/Video_2.mp4'] },
    { request_id: 'r3', video_storage_paths: ['u/b/Video_3.mp4'] },
    { request_id: 'r4', video_storage_paths: ['u/b/Video_4.mp4'] },
  ]

  const scores: ScoreRow[] = [
    { request_id: 'r1', ad_readiness_pct: 91, readiness_status: 'Ready' },
    { request_id: 'r2', ad_readiness_pct: 72, readiness_status: 'Needs Revision' },
    { request_id: 'r3', ad_readiness_pct: null, readiness_status: 'Cannot Assess' },
    { request_id: 'r4', ad_readiness_pct: 72, readiness_status: 'Needs Revision' },
  ]

  it('ranks by score, nulls last, filename as tiebreaker', () => {
    const { videos } = assembleVideoResults({
      requests,
      scores,
      dimensions: [],
      issues: [],
    })

    expect(videos.map((video) => [video.rank, video.name])).toEqual([
      [1, 'Video_1.mp4'],
      [2, 'Video_2.mp4'],
      [3, 'Video_4.mp4'],
      [4, 'Video_3.mp4'],
    ])
  })

  it('carries the storage path of the video whose name it shows', () => {
    // Ranking reorders the cards, so this guards against a video ending up
    // paired with a different video's clip.
    const { videos } = assembleVideoResults({
      requests,
      scores,
      dimensions: [],
      issues: [],
    })

    for (const video of videos) {
      expect(video.videoPath).toBe(`u/b/${video.name}`)
    }
  })

  it('leaves videoPath null when the request recorded no path', () => {
    const { videos } = assembleVideoResults({
      requests: [{ request_id: 'r1', video_storage_paths: null }],
      scores: [scores[0]],
      dimensions: [],
      issues: [],
    })

    expect(videos[0].videoPath).toBeNull()
    expect(videos[0].name).toBe('Untitled video')
  })

  it('produces the same order regardless of the order rows arrive in', () => {
    const forward = assembleVideoResults({ requests, scores, dimensions: [], issues: [] })
    const reversed = assembleVideoResults({
      requests: [...requests].reverse(),
      scores: [...scores].reverse(),
      dimensions: [],
      issues: [],
    })

    expect(reversed.videos.map((video) => video.name)).toEqual(
      forward.videos.map((video) => video.name),
    )
  })

  it('keeps a video thumbnail stable even though ranking reorders the cards', () => {
    const ranked = assembleVideoResults({ requests, scores, dimensions: [], issues: [] })
    const unscored = assembleVideoResults({
      requests,
      scores: [scores[0]],
      dimensions: [],
      issues: [],
    })

    const rankedThumb = ranked.videos.find((video) => video.name === 'Video_1.mp4')?.thumb
    const unscoredThumb = unscored.videos.find((video) => video.name === 'Video_1.mp4')?.thumb

    expect(rankedThumb).toBe(unscoredThumb)
  })

  it('counts requests without a score row as pending, not as results', () => {
    const partial = assembleVideoResults({
      requests,
      scores: [scores[0], scores[1]],
      dimensions: [],
      issues: [],
    })

    expect(partial.videos).toHaveLength(2)
    expect(partial.totalCount).toBe(4)
    expect(partial.complete).toBe(false)
    // Named, not just counted, so the processing view can list what's still running.
    expect(partial.pending.map((video) => video.name)).toEqual([
      'Video_3.mp4',
      'Video_4.mp4',
    ])
  })

  it('is complete only when every request has a score', () => {
    const done = assembleVideoResults({ requests, scores, dimensions: [], issues: [] })
    expect(done.complete).toBe(true)
    expect(done.pending).toHaveLength(0)
  })

  it('is not complete for an empty batch', () => {
    const empty = assembleVideoResults({
      requests: [],
      scores: [],
      dimensions: [],
      issues: [],
    })

    expect(empty.complete).toBe(false)
    expect(empty.totalCount).toBe(0)
  })

  it('attaches issues and dimensions to the right video', () => {
    const dimensions: DimensionRow[] = [
      { request_id: 'r1', dimension_id: 'claims_accuracy', name: 'Claims Accuracy', score: 92 },
      { request_id: 'r2', dimension_id: 'cta_effectiveness', name: 'CTA Effectiveness', score: 55 },
    ]
    const issues: IssueRow[] = [
      issueRow({ request_id: 'r2', metric_id: 'cta_clarity', severity: 'high' }),
      issueRow({ request_id: 'r2', metric_id: 'ignored', severity: 'none' }),
    ]

    const { videos } = assembleVideoResults({ requests, scores, dimensions, issues })
    const video1 = videos.find((video) => video.name === 'Video_1.mp4')!
    const video2 = videos.find((video) => video.name === 'Video_2.mp4')!

    expect(video1.issues).toHaveLength(0)
    expect(video1.metrics.map((metric) => metric.id)).toEqual(['claims_accuracy'])
    expect(video2.issues.map((issue) => issue.metricId)).toEqual(['cta_clarity'])
    expect(video2.metrics.map((metric) => metric.id)).toEqual(['cta_effectiveness'])
  })

  it('does not claim a video is clean when its only issues were filtered out', () => {
    const issues: IssueRow[] = [
      issueRow({ request_id: 'r3', metric_id: 'x', severity: 'cannot_assess' }),
    ]

    const { videos } = assembleVideoResults({ requests, scores, dimensions: [], issues })
    const unassessed = videos.find((video) => video.name === 'Video_3.mp4')!

    expect(unassessed.issues).toHaveLength(0)
    expect(unassessed.summary).toBe('This creative could not be assessed.')
    expect(unassessed.score).toBeNull()
    expect(unassessed.status).toBe('unassessed')
  })
})
