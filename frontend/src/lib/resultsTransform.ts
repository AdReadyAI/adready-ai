// Pure transforms: raw database rows -> Result UI shapes.
//
// Deliberately imports nothing but types. All the decisions that are easy to get
// wrong (which severities are hidden, how nulls sort, how a timestamp is
// formatted) live here so they can be unit tested without a database, a network,
// or environment variables. `results.ts` does the querying and calls into this.

import type {
  DisplaySeverity,
  Issue,
  Metric,
  Severity,
  ShipStatus,
  VideoResult,
} from '../types/results'

// ---- raw row shapes ------------------------------------------------------
// Typed loosely on purpose: these describe what comes back over the wire, so
// severity/status are plain strings and get validated rather than trusted.

export interface RequestRow {
  request_id: string
  video_storage_paths: string[] | null
}

export interface ScoreRow {
  request_id: string
  ad_readiness_pct: number | null
  readiness_status: string
}

export interface DimensionRow {
  request_id: string
  dimension_id: string
  name: string
  score: number | null
}

export interface IssueRow {
  request_id: string
  metric_id: string
  title: string | null
  detail: string | null
  severity: string
  repair_suggestion: string | null
  video_timestamp: string | null
}

/** A request in the batch with no score row yet — still being processed. */
export interface PendingVideo {
  requestId: string
  name: string
}

export interface BatchResults {
  /** Videos that have a score row, ranked. Videos still processing are excluded. */
  videos: VideoResult[]
  /** Named rather than counted so the processing view can list what's still running. */
  pending: PendingVideo[]
  totalCount: number
  /** True when every request in the batch has a score row. */
  complete: boolean
}

// ---- status --------------------------------------------------------------

const STATUS_BY_READINESS: Record<string, ShipStatus> = {
  Ready: 'ready',
  'Needs Revision': 'revision',
  'High Risk': 'nope',
  'Cannot Assess': 'unassessed',
}

/**
 * Migration 026's CHECK constrains this to four values, so the fallback should
 * be unreachable. It maps to 'unassessed' rather than throwing because an
 * unrecognized status genuinely means "we don't know how this video did" — the
 * same thing 'unassessed' already communicates — and a results page that throws
 * is worse than one that admits uncertainty.
 */
export function toShipStatus(raw: string): ShipStatus {
  return STATUS_BY_READINESS[raw] ?? 'unassessed'
}

// ---- severity ------------------------------------------------------------

/** Most severe first. Also the display order within a video. */
const SEVERITY_ORDER: DisplaySeverity[] = ['critical', 'high', 'medium', 'low']

export const SEVERITY_RANK: Record<DisplaySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/**
 * `none` and `cannot_assess` are excluded: an issue the pipeline could not rate
 * isn't actionable. Note `none` is not hypothetical — process-issues coerces any
 * unrecognized severity to "none", so malformed rows land here and are dropped.
 */
export function isDisplaySeverity(raw: string): raw is DisplaySeverity {
  return (SEVERITY_ORDER as string[]).includes(raw)
}

export function severityLabel(severity: DisplaySeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1)
}

// ---- timestamps ----------------------------------------------------------

function padSeconds(seconds: number): string {
  return seconds < 10 ? `0${seconds}` : String(seconds)
}

function formatSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${padSeconds(total % 60)}`
}

/**
 * `issues.video_timestamp` as a number of seconds, for seeking a video element.
 *
 * The column is TEXT with no format guarantee — producers may write "0:22",
 * "00:15", or raw seconds like "14.5" — so every accepted format is parsed here
 * and nowhere else. Returns null for anything unrecognized, which is stricter
 * than `normalizeTimestamp`: a timestamp we cannot turn into a number cannot be
 * seeked to, even though it is still worth displaying.
 *
 * Fractional seconds are floored to match the displayed label. Seeking to 14
 * when the chip reads 0:14 is right; seeking to 14.5 while showing 0:14 would
 * put the player a frame past the moment the user was pointed at.
 */
export function parseTimestampSeconds(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  const clock = trimmed.match(/^(\d+):([0-5]?\d)$/)
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2])
  }

  const seconds = trimmed.match(/^\d+(\.\d+)?$/)
  if (seconds) {
    return Math.floor(Number(trimmed))
  }

  return null
}

/**
 * The same value as a M:SS label for display.
 *
 * Deliberately built on top of `parseTimestampSeconds` rather than re-parsing:
 * two parsers that drift apart would show one time and seek to another.
 *
 * An unrecognized format is returned trimmed rather than dropped: showing an
 * odd-looking timestamp beats silently hiding the only pointer to where in the
 * video the problem is. Such a value has a label but no seconds, so it renders
 * a chip and no playable clip.
 */
export function normalizeTimestamp(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  const seconds = parseTimestampSeconds(trimmed)
  return seconds === null ? trimmed : formatSeconds(seconds)
}

// ---- presentation helpers ------------------------------------------------

/**
 * Thumbnail tints, assigned by position so a video keeps its color even as the
 * ranking reorders the cards. Purely cosmetic — no table stores this.
 */
const THUMBS = [
  'bg-violet-100 text-violet-500',
  'bg-emerald-100 text-emerald-500',
  'bg-amber-100 text-amber-500',
  'bg-rose-100 text-rose-500',
  'bg-sky-100 text-sky-500',
]

/**
 * Preferred bar order, mirroring the score engine's display_dimensions.
 *
 * This is an ordering hint, not a label map: dimensions missing from this list
 * still render (appended, sorted by name), so a new dimension added upstream
 * appears without a frontend change. Labels always come from the `name` column.
 */
const DIMENSION_ORDER = [
  'claims_accuracy',
  'product_representation',
  'storyline_brief',
  'cta_effectiveness',
  'brand_alignment',
  'visual_asset_quality',
]

export function videoNameFromPaths(paths: string[] | null): string {
  const first = paths?.[0]
  if (!first) return 'Untitled video'

  const basename = first.split('/').pop()
  return basename && basename !== '' ? basename : 'Untitled video'
}

/**
 * The object key to sign when playing the video back.
 *
 * `video_storage_paths` is an array because the column is shared with the
 * multi-asset shape, but a request carries exactly one video — CampaignForm
 * writes `[storagePath]`. Taking [0] mirrors `videoNameFromPaths`, so the clip
 * that plays is always the file whose name is on the card.
 */
export function videoPathFromPaths(paths: string[] | null): string | null {
  return paths?.[0] ?? null
}

/**
 * Stands in for the mock's editorial copy, which nothing produces. Counts only
 * *displayed* issues, so it can never claim more problems than are listed.
 */
export function buildSummary(issues: Issue[], status: ShipStatus): string {
  if (status === 'unassessed') {
    return 'This creative could not be assessed.'
  }
  if (issues.length === 0) {
    return 'No issues found.'
  }

  const counts = new Map<DisplaySeverity, number>()
  for (const issue of issues) {
    counts.set(issue.severity, (counts.get(issue.severity) ?? 0) + 1)
  }

  const breakdown = SEVERITY_ORDER.filter((severity) => counts.has(severity))
    .map((severity) => `${counts.get(severity)} ${severity}`)
    .join(', ')

  const noun = issues.length === 1 ? 'issue' : 'issues'
  return `${issues.length} ${noun} found — ${breakdown}`
}

// ---- row mapping ---------------------------------------------------------

/** Filters hidden severities, then sorts most-severe-first. */
export function toIssues(rows: IssueRow[]): Issue[] {
  return rows
    .filter((row) => isDisplaySeverity(row.severity))
    .map((row) => ({
      // The issues PK is (request_id, metric_id); neither alone is unique per
      // issue, and ResultPage matches the expanded row on this id.
      id: `${row.request_id}_${row.metric_id}`,
      metricId: row.metric_id,
      title: row.title,
      detail: row.detail,
      severity: row.severity as DisplaySeverity,
      repairText: row.repair_suggestion,
      timestamp: normalizeTimestamp(row.video_timestamp),
      timestampSeconds: parseTimestampSeconds(row.video_timestamp),
    }))
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (bySeverity !== 0) return bySeverity
      // Tiebreak so equal-severity rows don't reshuffle between renders.
      return a.metricId.localeCompare(b.metricId)
    })
}

export function toMetrics(rows: DimensionRow[]): Metric[] {
  return rows
    .map((row) => ({ id: row.dimension_id, label: row.name, value: row.score }))
    .sort((a, b) => {
      const aIndex = DIMENSION_ORDER.indexOf(a.id)
      const bIndex = DIMENSION_ORDER.indexOf(b.id)
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
      if (aIndex !== -1) return -1
      if (bIndex !== -1) return 1
      return a.label.localeCompare(b.label)
    })
}

// ---- assembly ------------------------------------------------------------

/**
 * Ranking: score descending, nulls last, filename as tiebreaker.
 *
 * The tiebreaker isn't cosmetic. Integer scores over a small batch collide often
 * and unassessed videos all share a null score; without a second key the cards
 * visibly reshuffle between renders.
 */
function compareForRank(a: VideoResult, b: VideoResult): number {
  if (a.score === null && b.score === null) return a.name.localeCompare(b.name)
  if (a.score === null) return 1
  if (b.score === null) return -1
  if (a.score !== b.score) return b.score - a.score
  return a.name.localeCompare(b.name)
}

export function assembleVideoResults(input: {
  requests: RequestRow[]
  scores: ScoreRow[]
  dimensions: DimensionRow[]
  issues: IssueRow[]
}): BatchResults {
  const { requests, scores, dimensions, issues } = input

  const scoreByRequest = new Map(scores.map((row) => [row.request_id, row]))

  // Thumb colors are assigned over a name-sorted list rather than the ranked
  // one, so a video's tint stays put when scores land and the ranking changes.
  const namedRequests = requests
    .map((request) => ({
      requestId: request.request_id,
      name: videoNameFromPaths(request.video_storage_paths),
      videoPath: videoPathFromPaths(request.video_storage_paths),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const thumbByRequest = new Map(
    namedRequests.map((request, index) => [
      request.requestId,
      THUMBS[index % THUMBS.length],
    ]),
  )

  const videos: VideoResult[] = []
  const pending: PendingVideo[] = []

  for (const request of namedRequests) {
    const score = scoreByRequest.get(request.requestId)
    if (!score) {
      pending.push({ requestId: request.requestId, name: request.name })
      continue
    }

    const status = toShipStatus(score.readiness_status)
    const videoIssues = toIssues(
      issues.filter((row) => row.request_id === request.requestId),
    )

    videos.push({
      requestId: request.requestId,
      rank: 0, // assigned after sorting
      name: request.name,
      videoPath: request.videoPath,
      score: score.ad_readiness_pct,
      status,
      thumb: thumbByRequest.get(request.requestId) ?? THUMBS[0],
      metrics: toMetrics(
        dimensions.filter((row) => row.request_id === request.requestId),
      ),
      summary: buildSummary(videoIssues, status),
      issues: videoIssues,
    })
  }

  videos.sort(compareForRank)
  videos.forEach((video, index) => {
    video.rank = index + 1
  })

  return {
    videos,
    pending,
    totalCount: requests.length,
    complete: requests.length > 0 && pending.length === 0,
  }
}

export type { Severity }
