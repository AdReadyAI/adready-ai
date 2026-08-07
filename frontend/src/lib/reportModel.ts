// Pure helpers shared by the Result page and its PDF export.
//
// Imports nothing but types, for the same reason resultsTransform.ts does: these
// are the decisions that are easy to get quietly wrong (a null score printing as
// 0, an empty issue list reading as "clean") and they need to be testable without
// a DOM, a network, or a PDF renderer.
//
// Anything here is called from BOTH the page and the exported document. That is
// the point — the two must never drift apart and tell the user different things
// about the same video.

import type { ShipStatus } from '../types/results'

// ---- file naming ---------------------------------------------------------

/** Local calendar date as YYYY-MM-DD. */
function isoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Download name for the exported report, e.g. `adready-report-8f3c1a90-2026-08-06.pdf`.
 *
 * Batch-scoped on purpose: exporting three batches in one session should not
 * produce three files called `adready-report.pdf` that overwrite or shadow each
 * other in the Downloads folder.
 *
 * The id is sanitized rather than interpolated raw — it arrives from the URL, so
 * it is user-controlled input on its way into a filesystem name. A batch id that
 * survives sanitizing to nothing falls back to a fixed stem so the file still has
 * a sensible name instead of a bare double hyphen.
 */
export function reportFileName(batchId: string, now: Date): string {
  const slug = batchId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  return `adready-report-${slug === '' ? 'batch' : slug}-${isoDate(now)}.pdf`
}

/**
 * Cover-page date, e.g. "August 6, 2026".
 *
 * Locale is pinned to en-US rather than left to the browser: the PDF is a shared
 * artifact, so the date it carries should not depend on which machine happened to
 * click Export.
 */
export function formatGeneratedAt(now: Date): string {
  return now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ---- score display -------------------------------------------------------

/** Em dash for a score that does not exist. */
export const NO_VALUE = '—'

/**
 * A score for display.
 *
 * null is not zero (see types/results.ts). A null score means the pipeline never
 * reached a verdict on this video; printing `0` would tell the user their creative
 * scored nothing, which is a different and much worse claim than "we couldn't
 * assess it". Both the on-screen circle and the PDF go through here.
 */
export function scoreText(score: number | null): string {
  return score === null ? NO_VALUE : String(score)
}

// ---- empty issue list ----------------------------------------------------

/**
 * What to say when a video has no issues to show.
 *
 * Gated on status, never on the issue count. `none` and `cannot_assess` severities
 * are dropped in the data layer, so an empty list does NOT prove a creative is
 * clean — a High Risk video can arrive here with zero displayable issues, and
 * telling its owner it is "ready to ship" would be flatly wrong.
 */
export function emptyIssuesCopy(status: ShipStatus): { title: string; body: string } {
  if (status === 'ready') {
    return {
      title: 'No issues found.',
      body: 'This creative is ready to ship.',
    }
  }

  if (status === 'unassessed') {
    return {
      title: 'Nothing to show.',
      body: 'This creative could not be assessed, so no issues were recorded.',
    }
  }

  return {
    title: 'No specific issues were listed.',
    body: 'This creative still scored below the ready-to-ship threshold.',
  }
}
