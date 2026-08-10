import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadReport } from './downloadReport'
import type { BatchResults } from './results'

const results: BatchResults = {
  videos: [
    {
      requestId: 'req-1',
      rank: 1,
      name: 'hero_cut_v3.mp4',
      videoPath: null,
      score: 82,
      status: 'ready',
      thumb: 'bg-violet-100 text-violet-500',
      metrics: [{ id: 'claims_accuracy', label: 'Claims Accuracy', value: 72 }],
      summary: 'No issues found.',
      issues: [],
    },
  ],
  pending: [],
  totalCount: 1,
  complete: true,
}

let clicked: Array<{ download: string; href: string }>
let revoked: string[]
let objectUrls: Blob[]

beforeEach(() => {
  // Only Date is faked — setTimeout stays real so the deferred revoke below can
  // be observed the way it actually behaves in a browser.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 7, 6))

  clicked = []
  revoked = []
  objectUrls = []

  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    objectUrls.push(blob)
    return `blob:mock-${objectUrls.length}`
  })
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  })

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href })
  })
})

afterEach(async () => {
  // Drain the pending revoke this test scheduled before tearing the mocks down.
  // Without this it fires during the NEXT test's render — which spans several
  // macrotasks — and lands in that test's freshly-reset `revoked` array.
  await nextTick()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Lets the real macrotask queue drain so the deferred revoke can run. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('downloadReport', () => {
  it('downloads a PDF named for the batch and the day', async () => {
    await downloadReport(results, '8f3c1a90-4b2e-4d1f-9c7a-1e2d3f4a5b6c')

    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('adready-report-8f3c1a90-2026-08-06.pdf')

    const bytes = new TextDecoder().decode(await objectUrls[0].slice(0, 5).arrayBuffer())
    expect(bytes).toBe('%PDF-')
  })

  it('leaves no anchor behind in the document', async () => {
    await downloadReport(results, 'batch-1')

    expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  })

  // Revoking in the same turn as click() can cancel the download before the
  // browser has finished reading the blob, so the deferral is load-bearing.
  it('revokes the object URL a tick after the click, not during it', async () => {
    await downloadReport(results, 'batch-1')
    expect(revoked).toEqual([])

    await nextTick()
    expect(revoked).toEqual(['blob:mock-1'])
  })
})
