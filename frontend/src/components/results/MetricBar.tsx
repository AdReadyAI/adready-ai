import type { Metric } from '../../types/results'

export default function MetricBar({ metric, barClass }: { metric: Metric; barClass: string }) {
  // A null score means this dimension was never assessed; zero means it was
  // assessed and scored nothing. Both would render as an empty track, so the
  // unassessed case gets a dashed outline and a dash instead of a number —
  // otherwise "we couldn't check this" reads as "you failed this".
  const unassessed = metric.value === null

  return (
    <div className="flex items-center gap-4">
      {/* Wider and tighter than the old w-20: dimension names now come from the
          database ("Product Representation", "Visual / Asset Quality") rather
          than the one-word mock labels, so they need room to wrap cleanly. */}
      <span className="w-28 shrink-0 text-sm leading-tight text-slate-700">{metric.label}</span>
      <span
        className={`h-2.5 flex-1 overflow-hidden rounded-full ${
          unassessed ? 'border border-dashed border-slate-300' : 'bg-slate-200'
        }`}
      >
        {!unassessed && (
          <span
            className={`block h-full rounded-full ${barClass}`}
            style={{ width: `${metric.value}%` }}
          />
        )}
      </span>
      <span
        className={`w-8 shrink-0 text-right text-base font-medium ${
          unassessed ? 'text-slate-400' : 'text-slate-700'
        }`}
        title={unassessed ? 'Could not assess this dimension' : undefined}
      >
        {unassessed ? '—' : metric.value}
      </span>
    </div>
  )
}
