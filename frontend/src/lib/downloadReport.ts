// Turns a batch's results into a PDF file in the user's Downloads folder.
//
// Deliberately tiny and free of heavy imports: ResultPage imports this module
// statically, so anything pulled in at the top level here lands in the main
// bundle for every visitor.

import { reportFileName } from './reportModel'
import type { BatchResults } from './results'

/**
 * Builds the report and hands it to the browser as a download.
 *
 * The `import()` is the point of this function. Written as a normal top-level
 * import, @react-pdf/renderer (~1MB before compression) would ship to everyone
 * who loads the app. As a dynamic import it becomes its own chunk that Vite only
 * fetches the first time someone actually clicks Export — so the cost falls on
 * the people using the feature. Nothing else may import ReportDocument
 * statically, or the chunk merges back into the main bundle and this silently
 * stops working.
 *
 * Throws if rendering fails; the caller is responsible for showing that.
 */
export async function downloadReport(data: BatchResults, batchId: string): Promise<void> {
  // One timestamp for both the filename and the cover, so a report dated
  // "August 6" can never be saved under a file named the 7th.
  const now = new Date()

  const { buildReportBlob } = await import('../components/results/ReportDocument')
  const blob = await buildReportBlob(data, batchId, now)

  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = reportFileName(batchId, now)
    // Firefox ignores a click on an anchor that was never in the document.
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Deferred by a tick rather than revoked inline: the browser reads the blob
    // asynchronously after click(), and revoking in the same turn can cancel the
    // download before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
