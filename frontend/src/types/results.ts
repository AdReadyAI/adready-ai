// Shapes for the Result UI, mirroring what the database can actually hold.
//
// These types are written against the CHECK constraints in migrations 025
// (issues) and 026 (result_score_table / result_score_dimensions), not against
// whatever a particular producer happens to emit today. Ownership of the write
// path belongs to the evaluation team and may change; the constraints are the
// stable contract.

/**
 * Overall readiness for one video.
 *
 * Maps `result_score_table.readiness_status`:
 *   Ready -> ready | Needs Revision -> revision
 *   High Risk -> nope | Cannot Assess -> unassessed
 *
 * `unassessed` means the pipeline could not evaluate the video at all. It is
 * NOT a bad score, and must never be presented as one — it pairs with a null
 * `score` and null `Metric.value`s.
 */
export type ShipStatus = 'ready' | 'revision' | 'nope' | 'unassessed'

/** Every value `issues.severity` may hold, per migration 025's CHECK. */
export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'cannot_assess'

/**
 * The severities actually shown to the user.
 *
 * `none` and `cannot_assess` are dropped in the data layer: an issue the
 * pipeline could not rate is not actionable, so surfacing it is noise. Deriving
 * this with Exclude rather than restating the union keeps it correct if the
 * evaluation team ever adds a severity — the new value shows up here
 * automatically instead of being silently unhandled.
 *
 * Because components take DisplaySeverity, the compiler prevents a filtered
 * severity from reaching the UI at all.
 */
export type DisplaySeverity = Exclude<Severity, 'none' | 'cannot_assess'>

/** One bar in the scorecard — a row of `result_score_dimensions`. */
export interface Metric {
  /** `dimension_id`, e.g. "cta_effectiveness". Stable key; not for display. */
  id: string
  /** `name`, already human-readable in the database. Rendered as-is. */
  label: string
  /**
   * 0-100, or null when the dimension could not be assessed.
   *
   * null is not zero. A zero bar means the video genuinely scored nothing on
   * this dimension; null means the check never produced a verdict. They must
   * not render the same way.
   */
  value: number | null
}

/** One row of `public.issues`, filtered and normalized for display. */
export interface Issue {
  /**
   * `${request_id}_${metric_id}`.
   *
   * The issues table's primary key is that pair — one video has many issues —
   * so there is no single-column id to use. This has to stay unique per issue:
   * ResultPage tracks which row is expanded by matching on it, so duplicates
   * would expand every issue on a video at once.
   */
  id: string
  /**
   * `metric_id`, shown as the badge.
   *
   * Today this often duplicates `title`, because the score engine writes the
   * raw metric id as the title (see scoreEngine.ts issueTitle). That is
   * expected: when the evaluation team makes `title` descriptive, the two
   * diverge on their own with no change here.
   */
  metricId: string
  title: string | null
  detail: string | null
  severity: DisplaySeverity
  /** `repair_suggestion`. The heading above it is fixed copy, not stored data. */
  repairText: string | null
  /**
   * `video_timestamp`, normalized by the data layer.
   *
   * The column is TEXT with no format guarantee — producers may write "0:22",
   * "00:15", or raw seconds like "14.5" — so it is normalized on the way in
   * rather than trusted. null when the issue has no associated frame.
   */
  timestamp: string | null
  /**
   * The same moment in seconds, for seeking the clip player.
   *
   * Not derivable from `timestamp` at the call site — that is a display label,
   * and re-parsing it in the component is how the shown time and the seeked
   * time drift apart. Both come from one parser in resultsTransform.
   *
   * These two can legitimately disagree on presence: a timestamp in a format we
   * do not recognize keeps its text (worth showing) but has null seconds
   * (nowhere to seek). So the player must gate on THIS field, not on
   * `timestamp` — otherwise an unparseable value seeks to NaN.
   */
  timestampSeconds: number | null
}

/** One video's complete result: a `requests` row joined to its scores and issues. */
export interface VideoResult {
  /** `requests.request_id`. Also the React key for the ranking cards. */
  requestId: string
  /** 1-based, computed client-side — no rank column exists in any table. */
  rank: number
  /** Filename, derived from `requests.video_storage_paths[0]`. */
  name: string
  /**
   * `video_storage_paths[0]` — the object key in the private `uploads` bucket.
   *
   * Not a URL. The bucket is private (migration 005) with SELECT scoped to the
   * owner's folder (migration 006), so playback needs a signed URL minted at
   * render time. Storing the key rather than a URL keeps expiry out of the
   * data layer. null when the request recorded no video path.
   */
  videoPath: string | null
  /** `ad_readiness_pct`. Null when `status` is 'unassessed'. */
  score: number | null
  status: ShipStatus
  /** Tailwind classes for the thumbnail tile. Presentation only, assigned client-side. */
  thumb: string
  metrics: Metric[]
  /** Derived from issue counts. No table stores this. */
  summary: string
  /** Already filtered and sorted most-severe-first by the data layer. */
  issues: Issue[]
}
