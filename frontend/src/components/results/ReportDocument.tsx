// The exported PDF: a cover page with the batch ranking, then one page per video
// carrying its scorecard and full issue list.
//
// ⚠️ Nothing in the app may import this module statically. `lib/downloadReport.ts`
// pulls it in with a dynamic `import()` so Vite splits it — and the ~1MB
// @react-pdf/renderer underneath it — into a chunk that is only fetched when
// someone actually clicks Export. A static import anywhere collapses that chunk
// back into the main bundle and every visitor pays for it.
//
// This renders outside the DOM, so there is no Tailwind here. Colours come from
// the `pdf` fields on status.ts, which are the hex twins of the classes the
// on-screen components use, and the wording of anything conditional comes from
// lib/reportModel.ts. Both are shared with ResultPage on purpose: an exported
// report that contradicts the screen it came from is worse than no report.

import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer'
import { SEVERITY_STYLE, STATUS } from './status'
import { emptyIssuesCopy, formatGeneratedAt, scoreText } from '../../lib/reportModel'
import type { BatchResults } from '../../lib/results'
import type { Issue, Metric, VideoResult } from '../../types/results'

// react-pdf has no stylesheet cascade — every value is literal. Sizes are in
// points (72pt = 1 inch); A4 is 595 x 842pt, so 40pt margins leave ~515pt of
// usable width, which is what the column widths below add up to.
const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56, // room for the fixed footer
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1e293b',
  },

  // ---- cover ----
  title: { fontFamily: 'Helvetica-Bold', fontSize: 24, color: '#0f172a' },
  subtitle: { marginTop: 6, fontSize: 10, color: '#64748b' },
  coverHeading: {
    marginTop: 32,
    marginBottom: 10,
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: '#0f172a',
  },

  // ---- ranking table ----
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingVertical: 8,
  },
  headCell: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#64748b' },
  colRank: { width: 40 },
  colName: { flex: 1, paddingRight: 8 },
  colScore: { width: 50, textAlign: 'right', paddingRight: 16 },
  colStatus: { width: 110 },

  // ---- per-video section ----
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  rank: { fontFamily: 'Helvetica-Bold', fontSize: 12, color: '#94a3b8', width: 28 },
  videoName: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 16, color: '#0f172a' },
  bigScore: { fontFamily: 'Helvetica-Bold', fontSize: 22, marginRight: 10 },
  summary: { marginTop: 10, fontSize: 10, color: '#475569', lineHeight: 1.5 },
  heading: {
    marginTop: 22,
    marginBottom: 10,
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
    color: '#0f172a',
  },

  // ---- status / severity pills ----
  pill: { borderRadius: 3, paddingHorizontal: 6, paddingVertical: 3 },
  pillText: { fontFamily: 'Helvetica-Bold', fontSize: 8 },

  // ---- score breakdown ----
  metricRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  metricLabel: { width: 130, fontSize: 9, color: '#334155', paddingRight: 8 },
  track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: '#e2e8f0' },
  // An unassessed dimension gets an empty dashed outline, never a 0%-wide bar —
  // see MetricBar.tsx for why "we couldn't check this" must not look like "you
  // scored nothing".
  trackUnassessed: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
  },
  fill: { height: '100%', borderRadius: 4 },
  metricValue: { width: 28, textAlign: 'right', fontSize: 9 },

  // ---- issues ----
  issue: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 2,
    marginBottom: 14,
  },
  issueHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  metricId: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#0f172a', marginLeft: 6 },
  timestamp: { fontSize: 9, color: '#64748b', marginLeft: 6 },
  issueTitle: { fontSize: 10, color: '#0f172a', marginBottom: 3 },
  issueDetail: { fontSize: 9.5, color: '#475569', lineHeight: 1.5 },
  repair: {
    marginTop: 6,
    backgroundColor: '#f8fafc',
    borderRadius: 3,
    padding: 7,
  },
  repairLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#64748b' },
  repairBody: { marginTop: 3, fontSize: 9.5, color: '#334155', lineHeight: 1.5 },

  // ---- empty state ----
  empty: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 4,
    paddingVertical: 20,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 10, color: '#475569' },
  emptyBody: { marginTop: 3, fontSize: 9, color: '#94a3b8' },

  footer: {
    position: 'absolute',
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: '#94a3b8',
    textAlign: 'center',
  },
})

function StatusPill({ status }: { status: VideoResult['status'] }) {
  const { label, pdf: palette } = STATUS[status]
  return (
    <View style={[styles.pill, { backgroundColor: palette.pillBg }]}>
      <Text style={[styles.pillText, { color: palette.pillText }]}>{label}</Text>
    </View>
  )
}

function MetricRow({ metric, barColor }: { metric: Metric; barColor: string }) {
  const unassessed = metric.value === null

  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{metric.label}</Text>
      <View style={[styles.track, unassessed ? styles.trackUnassessed : {}]}>
        {!unassessed && (
          // Clamped because the bar width is a layout instruction, not a label:
          // a stray 120 from upstream would overflow the row rather than just
          // read oddly. The number printed alongside is never clamped.
          <View
            style={[
              styles.fill,
              {
                width: `${Math.min(100, Math.max(0, metric.value ?? 0))}%`,
                backgroundColor: barColor,
              },
            ]}
          />
        )}
      </View>
      <Text
        style={[styles.metricValue, { color: unassessed ? '#94a3b8' : '#334155' }]}
      >
        {scoreText(metric.value)}
      </Text>
    </View>
  )
}

function IssueBlock({ issue }: { issue: Issue }) {
  const severity = SEVERITY_STYLE[issue.severity]

  // `title` is frequently the raw metric id today (see types/results.ts), so it
  // is only printed once it actually says something the badge does not.
  const showTitle = issue.title !== null && issue.title !== issue.metricId

  return (
    // wrap={false} keeps a single issue from splitting across a page break — a
    // detail on one page and its repair suggestion on the next is unreadable.
    <View style={[styles.issue, { borderLeftColor: severity.pdf.accent }]} wrap={false}>
      <View style={styles.issueHead}>
        <View style={[styles.pill, { backgroundColor: severity.pdf.pillBg }]}>
          <Text style={[styles.pillText, { color: severity.pdf.pillText }]}>
            {severity.label}
          </Text>
        </View>
        <Text style={styles.metricId}>{issue.metricId}</Text>
        {issue.timestamp !== null && <Text style={styles.timestamp}>· {issue.timestamp}</Text>}
      </View>

      {showTitle && <Text style={styles.issueTitle}>{issue.title}</Text>}
      {issue.detail !== null && <Text style={styles.issueDetail}>{issue.detail}</Text>}

      {/* No repair suggestion means no heading — an empty "How to fix" reads as
          a broken document rather than as missing data. */}
      {issue.repairText !== null && (
        <View style={styles.repair}>
          <Text style={styles.repairLabel}>HOW TO FIX</Text>
          <Text style={styles.repairBody}>{issue.repairText}</Text>
        </View>
      )}
    </View>
  )
}

function VideoSection({ video }: { video: VideoResult }) {
  const status = STATUS[video.status]
  const empty = emptyIssuesCopy(video.status)

  return (
    // Every creative starts its own page, including the first, so the cover's
    // ranking is never crowded by a half-section beneath it.
    <View break>
      <View style={styles.sectionHead}>
        <Text style={styles.rank}>#{video.rank}</Text>
        <Text style={styles.videoName}>{video.name}</Text>
        <Text style={[styles.bigScore, { color: status.pdf.pillText }]}>
          {scoreText(video.score)}
        </Text>
        <StatusPill status={video.status} />
      </View>

      <Text style={styles.summary}>{video.summary}</Text>

      <Text style={styles.heading}>Score Breakdown</Text>
      {video.metrics.length === 0 ? (
        <Text style={styles.emptyBody}>No dimension scores were recorded.</Text>
      ) : (
        video.metrics.map((metric) => (
          <MetricRow key={metric.id} metric={metric} barColor={status.pdf.bar} />
        ))
      )}

      <Text style={styles.heading}>
        Issues ({video.issues.length})
      </Text>
      {video.issues.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{empty.title}</Text>
          <Text style={styles.emptyBody}>{empty.body}</Text>
        </View>
      ) : (
        video.issues.map((issue) => <IssueBlock key={issue.id} issue={issue} />)
      )}
    </View>
  )
}

export interface ReportDocumentProps {
  data: BatchResults
  batchId: string
  /** Injected rather than read from the clock so the output is reproducible. */
  now: Date
}

export function ReportDocument({ data, batchId, now }: ReportDocumentProps) {
  const count = data.videos.length

  return (
    <Document title={`AdReady AI — Creative Review`} author="AdReady AI">
      {/* One Page element, not one per video: react-pdf paginates the content
          itself, so `break` on each section controls where pages start while the
          fixed footer still repeats on every generated page. */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>AdReady AI — Creative Review</Text>
        <Text style={styles.subtitle}>
          {count} {count === 1 ? 'video' : 'videos'} · Batch {batchId} ·{' '}
          {formatGeneratedAt(now)}
        </Text>

        <Text style={styles.coverHeading}>Creative Ranking</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.headCell, styles.colRank]}>RANK</Text>
          <Text style={[styles.headCell, styles.colName]}>VIDEO</Text>
          <Text style={[styles.headCell, styles.colScore]}>SCORE</Text>
          <Text style={[styles.headCell, styles.colStatus]}>STATUS</Text>
        </View>
        {data.videos.map((video) => (
          <View key={video.requestId} style={styles.tableRow}>
            <Text style={styles.colRank}>{video.rank}</Text>
            <Text style={styles.colName}>{video.name}</Text>
            <Text style={styles.colScore}>{scoreText(video.score)}</Text>
            <View style={styles.colStatus}>
              <StatusPill status={video.status} />
            </View>
          </View>
        ))}

        {data.videos.map((video) => (
          <VideoSection key={video.requestId} video={video} />
        ))}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  )
}

/**
 * Renders the report to a Blob, ready to hand to a download anchor.
 *
 * Sharing a module with components trips the Fast Refresh lint rule, which does
 * not apply here: nothing in this file is ever mounted in the React tree — the
 * whole module exists to be dynamically imported, rendered to bytes, and thrown
 * away. Splitting it out would buy a hot-reload guarantee for code that never
 * hot-reloads, at the cost of separating the document from the one function that
 * turns it into a file.
 */
// eslint-disable-next-line react/only-export-components
export async function buildReportBlob(
  data: BatchResults,
  batchId: string,
  now: Date,
): Promise<Blob> {
  return pdf(<ReportDocument data={data} batchId={batchId} now={now} />).toBlob()
}
