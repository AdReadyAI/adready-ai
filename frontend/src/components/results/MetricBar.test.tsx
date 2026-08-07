import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MetricBar from './MetricBar'

describe('MetricBar', () => {
  it('renders a scored dimension as a filled bar', () => {
    const { container } = render(
      <MetricBar metric={{ id: 'cta_effectiveness', label: 'CTA', value: 55 }} barClass="bg-amber-400" />,
    )

    expect(screen.getByText('55')).toBeVisible()
    expect(container.querySelector('.bg-amber-400')).not.toBeNull()
  })

  it('distinguishes an unassessed dimension from a zero score', () => {
    const { container: zero } = render(
      <MetricBar metric={{ id: 'cta_effectiveness', label: 'CTA', value: 0 }} barClass="bg-red-400" />,
    )
    const { container: unassessed } = render(
      <MetricBar metric={{ id: 'brand_alignment', label: 'Brand', value: null }} barClass="bg-red-400" />,
    )

    // Both have an empty-looking track, so the difference has to be explicit:
    // zero shows a number and a solid track, null shows a dash and a dashed one.
    expect(zero.textContent).toContain('0')
    expect(zero.querySelector('.border-dashed')).toBeNull()

    expect(unassessed.textContent).toContain('—')
    expect(unassessed.querySelector('.border-dashed')).not.toBeNull()
    expect(unassessed.querySelector('.bg-red-400')).toBeNull()
  })
})
