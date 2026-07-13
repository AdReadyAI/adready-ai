import type { Metric } from '../../types/results'

export default function MetricBar({ metric, barClass }: { metric: Metric; barClass: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-20 shrink-0 text-base text-slate-700">{metric.label}</span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full rounded-full ${barClass}`}
          style={{ width: `${metric.value}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-base font-medium text-slate-700">
        {metric.value}
      </span>
    </div>
  )
}
