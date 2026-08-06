// Smoke tests for the PDF export.
//
// These do not inspect the rendered document — parsing a PDF back into text is
// far more machinery than it is worth. What they DO catch is the whole class of
// failure TypeScript cannot see: react-pdf validates styles and layout at render
// time, so an unsupported property or a bad percentage throws here rather than in
// front of a user who just clicked Export.

import { describe, expect, it } from 'vitest'
import { buildReportBlob } from './ReportDocument'
import type { BatchResults } from '../../lib/results'
import type { VideoResult } from '../../types/results'

const NOW = new Date(2026, 7, 6)

function video(overrides: Partial<VideoResult> = {}): VideoResult {
  return {
    requestId: 'req-1',
    rank: 1,
    name: 'hero_cut_v3.mp4',
    score: 82,
    status: 'ready',
    thumb: 'bg-violet-100 text-violet-500',
    metrics: [
      { id: 'claims_accuracy', label: 'Claims Accuracy', value: 72 },
      { id: 'cta_effectiveness', label: 'CTA Effectiveness', value: 0 },
    ],
    summary: '2 issues found — 1 high, 1 low',
    issues: [
      {
        id: 'req-1_cta_effectiveness',
        metricId: 'cta_effectiveness',
        title: 'CTA is too short',
        detail: 'The call to action holds for under a second.',
        severity: 'high',
        repairText: 'Hold the CTA for at least 2s.',
        timestamp: '0:22',
      },
    ],
    ...overrides,
  }
}

function batch(videos: VideoResult[]): BatchResults {
  return { videos, pending: [], totalCount: videos.length, complete: true }
}

/** The first bytes of any valid PDF file. */
async function magicBytes(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer())
}

describe('buildReportBlob', () => {
  it('produces a real PDF', async () => {
    const blob = await buildReportBlob(batch([video()]), 'batch-1', NOW)

    expect(await magicBytes(blob)).toBe('%PDF-')
    expect(blob.size).toBeGreaterThan(1000)
  })

  // Every branch in the document that depends on nullable data, rendered in one
  // pass. An unassessed video is the risky one: null score, null metric values,
  // and no issues all at once.
  it('renders every nullable branch without throwing', async () => {
    const blob = await buildReportBlob(
      batch([
        video(),
        video({
          requestId: 'req-2',
          rank: 2,
          name: 'teaser.mp4',
          score: null,
          status: 'unassessed',
          metrics: [{ id: 'brand_alignment', label: 'Brand Alignment', value: null }],
          summary: 'This creative could not be assessed.',
          issues: [],
        }),
        video({
          requestId: 'req-3',
          rank: 3,
          name: 'promo_b.mp4',
          score: 41,
          status: 'nope',
          metrics: [],
          issues: [
            {
              id: 'req-3_claims_accuracy',
              // title identical to metricId: the section must not print it twice.
              metricId: 'claims_accuracy',
              title: 'claims_accuracy',
              detail: null,
              severity: 'critical',
              repairText: null,
              timestamp: null,
            },
          ],
        }),
      ]),
      'batch-2',
      NOW,
    )

    expect(await magicBytes(blob)).toBe('%PDF-')
  })

  it('handles a batch with no scored videos', async () => {
    const blob = await buildReportBlob(batch([]), 'batch-3', NOW)

    expect(await magicBytes(blob)).toBe('%PDF-')
  })
})
