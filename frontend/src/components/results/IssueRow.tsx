import type { Issue } from '../../types/results'
import ChevronDownIcon from '../icons/ChevronDownIcon'

export default function IssueRow({
  issue,
  expanded,
  onToggle,
}: {
  issue: Issue
  expanded: boolean
  onToggle: () => void
}) {
  const accent = issue.severity === 'high' ? 'border-l-red-500' : 'border-l-amber-400'
  const sevPill =
    issue.severity === 'high' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 border-l-4 bg-white ${accent}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left"
      >
        {issue.severityLabel && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${sevPill}`}>
            {issue.severityLabel}
          </span>
        )}
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
          {issue.timestamp}
        </span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${sevPill}`}> {issue.tag}</span>
        <span className="text-sm font-medium text-slate-700">— {issue.title}</span>
        <ChevronDownIcon
          className={`ml-auto h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="grid grid-cols-1 gap-6 border-t border-slate-100 px-5 py-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">Timestamp</p>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-slate-900">
              <span className="absolute left-3 top-3 text-xs font-medium text-white/90">
                {issue.frameLabel}
              </span>
              <span className="absolute bottom-3 left-3 text-xs font-semibold text-white">
                {issue.timestamp}
              </span>
              <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
                <span className="block h-full w-1/4 bg-red-500" />
              </span>
            </div>
            <button
              type="button"
              className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
            >
              → View entire video clip
            </button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">Issue Detail</p>
            <p className="text-sm leading-relaxed text-slate-700">{issue.detail}</p>

            <p className="mb-2 mt-5 text-xs font-semibold tracking-wide text-slate-500">
              Repair Workspace
            </p>
            <div className="rounded-lg border-l-4 border-violet-500 bg-slate-100 p-4">
              <p className="text-sm font-semibold text-slate-900">{issue.repairTitle}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{issue.repairText}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
