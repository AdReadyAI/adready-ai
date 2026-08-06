import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IssueRow from './IssueRow'
import type { Issue } from '../../types/results'

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'req-1_cta_clarity',
    metricId: 'cta_clarity',
    title: 'Weak call to action',
    detail: 'The CTA is on screen for under a second.',
    severity: 'high',
    repairText: 'Hold the CTA card for 2s.',
    timestamp: '0:22',
    timestampSeconds: 22,
    ...overrides,
  }
}

describe('IssueRow severity', () => {
  it('renders critical distinctly from medium', () => {
    const { container: critical } = render(
      <IssueRow issue={issue({ severity: 'critical' })} expanded={false} onToggle={vi.fn()} />,
    )
    const criticalPill = critical.querySelector('.bg-red-100')

    const { container: medium } = render(
      <IssueRow issue={issue({ severity: 'medium' })} expanded={false} onToggle={vi.fn()} />,
    )
    const mediumPill = medium.querySelector('.bg-amber-100')

    // The regression this guards: the old `severity === 'high' ? red : amber`
    // check painted critical amber, identical to medium.
    expect(criticalPill).not.toBeNull()
    expect(mediumPill).not.toBeNull()
    expect(critical.querySelector('.bg-amber-100')).toBeNull()
  })

  it('labels each severity', () => {
    render(<IssueRow issue={issue({ severity: 'low' })} expanded={false} onToggle={vi.fn()} />)
    expect(screen.getByText('Low')).toBeVisible()
  })
})

describe('IssueRow nullable fields', () => {
  it('omits the timestamp chip and clip link when there is no timestamp', () => {
    render(
      <IssueRow issue={issue({ timestamp: null })} expanded onToggle={vi.fn()} />,
    )

    expect(screen.getByText('No frame captured')).toBeVisible()
    expect(screen.queryByText('→ View entire video clip')).toBeNull()
  })

  it('shows the timestamp and clip link when there is one', () => {
    render(<IssueRow issue={issue({ timestamp: '1:05' })} expanded onToggle={vi.fn()} />)

    expect(screen.getByText('Ad creative frame · 1:05')).toBeVisible()
    expect(screen.getByText('→ View entire video clip')).toBeVisible()
  })

  it('hides the repair block entirely when no suggestion was stored', () => {
    render(<IssueRow issue={issue({ repairText: null })} expanded onToggle={vi.fn()} />)

    expect(screen.queryByText('Repair Workspace')).toBeNull()
    expect(screen.queryByText('Suggested fix')).toBeNull()
  })

  it('falls back rather than rendering an empty detail', () => {
    render(<IssueRow issue={issue({ detail: null })} expanded onToggle={vi.fn()} />)

    expect(screen.getByText('No further detail was provided for this issue.')).toBeVisible()
  })
})

describe('IssueRow metric badge', () => {
  it('shows the metric id alongside a descriptive title', () => {
    render(
      <IssueRow
        issue={issue({ metricId: 'cta_clarity', title: 'Weak call to action' })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getByText('cta_clarity')).toBeVisible()
  })

  it('does not print the metric id twice when the title is just the metric id', () => {
    // The score engine currently writes metric_id as the title, so without this
    // guard the row reads "[cta_clarity] — cta_clarity".
    render(
      <IssueRow
        issue={issue({ metricId: 'cta_clarity', title: 'cta_clarity' })}
        expanded={false}
        onToggle={vi.fn()}
      />,
    )

    expect(screen.getAllByText(/cta_clarity/)).toHaveLength(1)
  })
})
