import { describe, expect, it } from 'vitest'
import {
  emptyIssuesCopy,
  formatGeneratedAt,
  NO_VALUE,
  reportFileName,
  scoreText,
} from './reportModel'

// Built with the local-time constructor, not an ISO string. `new Date('2026-08-06')`
// is UTC midnight, which is still August 5th in every US timezone — these helpers
// read the local calendar date, so an ISO literal would make the tests fail by
// timezone rather than by behavior.
const AUG_6 = new Date(2026, 7, 6)

describe('reportFileName', () => {
  it('scopes the name to the batch and the day', () => {
    expect(reportFileName('8f3c1a90-4b2e-4d1f-9c7a-1e2d3f4a5b6c', AUG_6)).toBe(
      'adready-report-8f3c1a90-2026-08-06.pdf',
    )
  })

  it('zero-pads single-digit months and days', () => {
    expect(reportFileName('abcdef12', new Date(2026, 0, 5))).toBe(
      'adready-report-abcdef12-2026-01-05.pdf',
    )
  })

  it('strips characters that have no business in a filename', () => {
    expect(reportFileName('../../etc/passwd', AUG_6)).toBe(
      'adready-report-etcpassw-2026-08-06.pdf',
    )
  })

  it('falls back to a fixed stem when nothing survives sanitizing', () => {
    expect(reportFileName('///', AUG_6)).toBe('adready-report-batch-2026-08-06.pdf')
  })
})

describe('formatGeneratedAt', () => {
  it('renders a readable date rather than a machine timestamp', () => {
    expect(formatGeneratedAt(AUG_6)).toBe('August 6, 2026')
  })
})

describe('scoreText', () => {
  it('shows the score when there is one', () => {
    expect(scoreText(82)).toBe('82')
  })

  // The one that matters: 0 is falsy, so a truthiness check here would print a
  // dash and hide a real, genuinely awful score behind "could not assess".
  it('treats a zero score as a score, not as missing', () => {
    expect(scoreText(0)).toBe('0')
  })

  it('shows a dash for a video that was never assessed', () => {
    expect(scoreText(null)).toBe(NO_VALUE)
  })
})

describe('emptyIssuesCopy', () => {
  it('only claims a creative is ready when the status says so', () => {
    expect(emptyIssuesCopy('ready').body).toContain('ready to ship')
  })

  it('says nothing was assessed for an unassessed creative', () => {
    expect(emptyIssuesCopy('unassessed').body).toContain('could not be assessed')
  })

  // An empty list is not proof of a clean creative: `none` and `cannot_assess`
  // severities are filtered out upstream, so a failing video can reach this
  // branch with zero displayable issues. It must never be told it can ship.
  it.each(['revision', 'nope'] as const)(
    'does not tell a %s creative it is ready to ship',
    (status) => {
      const copy = emptyIssuesCopy(status)
      expect(copy.title).toBe('No specific issues were listed.')
      expect(copy.body).toContain('below the ready-to-ship threshold')
    },
  )
})
