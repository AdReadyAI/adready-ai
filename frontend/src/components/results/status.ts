import type { DisplaySeverity, ShipStatus } from '../../types/results'

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
  // Deliberately grey rather than red. The pipeline could not evaluate this
  // video at all, which is not the same as it scoring badly — colouring it like
  // a failure would tell the user their ad was rejected when it was never
  // actually judged.
  unassessed: {
    label: 'Could not assess',
    pill: 'bg-slate-200 text-slate-600',
    scoreBadge: 'bg-slate-50 border-slate-300 text-slate-400',
    bigCircle: 'bg-slate-100 border-slate-300 text-slate-400',
    bar: 'bg-slate-300',
  },
}

/**
 * Three visual buckets across four severities: critical and high share red,
 * medium is amber, low is grey.
 *
 * critical and high looking alike is intentional and safe here — issues are
 * sorted most-severe-first, so a critical is always the top row of the list.
 * What matters is that critical no longer renders as amber, which is what the
 * old `severity === 'high' ? red : amber` check did.
 *
 * `none` and `cannot_assess` are absent because DisplaySeverity excludes them;
 * they are filtered out in the data layer and cannot reach this map.
 */
export const SEVERITY_STYLE: Record<
  DisplaySeverity,
  { label: string; pill: string; accent: string }
> = {
  critical: {
    label: 'Critical',
    pill: 'bg-red-100 text-red-600',
    accent: 'border-l-red-500',
  },
  high: {
    label: 'High',
    pill: 'bg-red-100 text-red-600',
    accent: 'border-l-red-500',
  },
  medium: {
    label: 'Medium',
    pill: 'bg-amber-100 text-amber-700',
    accent: 'border-l-amber-400',
  },
  low: {
    label: 'Low',
    pill: 'bg-slate-100 text-slate-600',
    accent: 'border-l-slate-300',
  },
}
