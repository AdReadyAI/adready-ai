import type { ShipStatus } from '../../types/results'

export const STATUS: Record<
  ShipStatus,
  {
    label: string
    pill: string
    scoreBadge: string
    bigCircle: string
    bar: string
  }
> = {
  ready: {
    label: 'Ready to Ship',
    pill: 'bg-green-100 text-green-700',
    scoreBadge: 'bg-green-50 border-green-300 text-green-600',
    bigCircle: 'bg-green-100 border-green-300 text-green-700',
    bar: 'bg-green-500',
  },
  revision: {
    label: 'Needs Revision',
    pill: 'bg-amber-100 text-amber-700',
    scoreBadge: 'bg-amber-50 border-amber-300 text-amber-600',
    bigCircle: 'bg-amber-100 border-amber-300 text-amber-700',
    bar: 'bg-amber-400',
  },
  nope: {
    label: 'Do not ship',
    pill: 'bg-red-100 text-red-600',
    scoreBadge: 'bg-red-100 border-red-300 text-red-500',
    bigCircle: 'bg-red-200 border-red-300 text-red-600',
    bar: 'bg-red-400',
  },
}
