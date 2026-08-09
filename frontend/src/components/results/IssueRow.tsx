import type { Issue } from '../../types/results'
import ChevronDownIcon from '../icons/ChevronDownIcon'
import IssueClip from './IssueClip'
import { SEVERITY_STYLE } from './status'

export default function IssueRow({
  issue,
  expanded,
  onToggle,
  videoUrl = null,
}: {
  issue: Issue
  expanded: boolean
  onToggle: () => void
  /** Signed URL for the parent video. Optional: it's signed asynchronously, so
   *  the row renders a static frame until it arrives. */
  videoUrl?: string | null
}) {
  // Replaces the old `severity === 'high' ? red : amber` check, which rendered
  // `critical` identically to `medium`. Indexing is safe without a fallback
  // because Issue.severity is DisplaySeverity, so the map covers every case.
  const style = SEVERITY_STYLE[issue.severity]

  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-200 border-l-4 bg-white ${style.accent}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-5 py-4 text-left"
      >
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${style.pill}`}>
          {style.label}
        </span>
        {issue.timestamp && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {issue.timestamp}
          </span>
        )}
        {/* The metric id, until the evaluation team makes `title` descriptive.
            Hidden when it would just repeat the title verbatim. */}
        {issue.metricId !== issue.title && (
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${style.pill}`}>
            {issue.metricId}
          </span>
        )}
        {issue.title && (
          <span className="truncate text-sm font-medium text-slate-700">— {issue.title}</span>
        )}
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
            <IssueClip
              src={videoUrl}
              startSeconds={issue.timestampSeconds}
              label={issue.timestamp}
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">Issue Detail</p>
            <p className="text-sm leading-relaxed text-slate-700">
              {issue.detail ?? 'No further detail was provided for this issue.'}
            </p>

            {/* The heading is fixed copy — the issues table stores only the
                suggestion body, with no column for a title. */}
            {issue.repairText && (
              <>
                <p className="mb-2 mt-5 text-xs font-semibold tracking-wide text-slate-500">
                  Repair Workspace
                </p>
                <div className="rounded-lg border-l-4 border-violet-500 bg-slate-100 p-4">
                  <p className="text-sm font-semibold text-slate-900">Suggested fix</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{issue.repairText}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
