// Pure transforms: raw database rows -> loading-screen shapes.
//
// Same split as resultsTransform.ts — every decision that is easy to get wrong
// (what "failed" means, what counts as done, how the bar is weighted) lives here
// so it can be unit tested without a database, a network, or env vars.
// `progress.ts` does the querying and calls into this.
//
// ## Where the numbers come from
//
// Nothing in this file reads a "progress" column, because none exists. Progress
// is inferred from evidence the pipeline writes for its own reasons:
//
//   requests.media_processing_status   worker/app/supabase.py:60-88 (migration 055)
//   requests.agents_triggered_at       migration 044's trigger
//   agent_results.agent                whichever evaluators have reported
//   result_score_table                 written last, by complete-evaluation
//
// The upside of deriving rather than storing: the bar cannot lie. A worker that
// dies mid-run leaves evidence that stops advancing, instead of a stale 80%.

import { THUMBS, videoNameFromPaths } from './resultsTransform'
import { isTerminal } from '../types/progress'
import type {
  BatchProgress,
  ProgressUnit,
  StageProgress,
  UnitStatus,
  VideoProgress,
} from '../types/progress'

// ---- raw row shapes ------------------------------------------------------
// Typed loosely on purpose, exactly as resultsTransform does: these describe
// what comes back over the wire, so the status columns are plain `string` and
// get mapped rather than trusted. Migration 042 has already widened one of these
// CHECK constraints once; a narrow union here would turn the next addition into
// a build failure instead of a graceful degrade.

export interface ProgressRequestRow {
  request_id: string
  video_storage_paths: string[] | null
  /** 'pending' | 'processing' | 'completed' | 'failed', or null before pickup. */
  media_processing_status: string | null
  /** Stable browser-safe category; raw producer diagnostics are never selected. */
  media_processing_failure_code: string | null
  /** Set by migration 044 when the agents were dispatched. Null means they never were. */
  agents_triggered_at: string | null
  /** 'pending' | 'processing' | 'completed' | 'failed', or null. Migration 048. */
  evaluation_completion_status: string | null
}

export interface AgentResultRow {
  request_id: string
  agent: string
}

export interface ScoredRequestRow {
  request_id: string
}

// ---- the expected work ---------------------------------------------------

/**
 * Weights, not equal counts.
 *
 * Media processing is the long pole — downloading, frame sampling, transcription
 * and OCR, minutes of wall clock. Each evaluator is one LLM round trip. Writing
 * the scorecard is a pair of projections. 5 / 7×1 / 1 puts roughly 38% of the bar
 * on media, 54% on evaluation and 8% on scoring, which is about how the wait
 * actually feels. Tune them here; nothing else needs to change.
 */
const MEDIA_WEIGHT = 5
const EVALUATOR_WEIGHT = 1
const SCORING_WEIGHT = 1

/**
 * The seven evaluators, keyed by the value they write into `agent_results.agent`.
 *
 * ⚠️ These are **agent names, not dimension ids**. The two look similar and are
 * not the same: `storyline_clarity` and `brief_alignment` are separate agents
 * that both feed the single `storyline_brief` dimension, and the agent that
 * feeds `visual_asset_quality` is called `visual_quality`. Getting this wrong is
 * silent — the affected rows simply never tick, and the bar parks partway.
 *
 * The authoritative list is the `agent` enum in
 * `supabase/functions/shared/schemas.ts` (MetricResultSchema), which every agent
 * validates its output against. Migration 044's dispatch array is the same seven
 * in kebab-case; those are Edge Function directory names and must NOT be used
 * here.
 */
export const EVALUATORS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'claims_accuracy', label: 'Claim accuracy' },
  { key: 'brief_alignment', label: 'Brief alignment' },
  { key: 'storyline_clarity', label: 'Storyline clarity' },
  { key: 'product_representation', label: 'Product representation' },
  { key: 'brand_alignment', label: 'Brand alignment' },
  { key: 'cta_effectiveness', label: 'CTA effectiveness' },
  { key: 'visual_quality', label: 'Visual quality' },
]

/** Shown on downstream work that will never run because the video died first. */
const SKIPPED_DETAIL = 'Skipped — video processing failed'
const MEDIA_FAILURE_DETAIL =
  'Automated video processing could not finish, so this creative could not be reviewed.'
const MEDIA_RETRIES_EXHAUSTED_DETAIL =
  'Automated video processing could not finish after multiple attempts. Try again later or contact support.'
const DEGRADED_MEDIA_DETAIL =
  'Some video analysis could not be completed, so the review continued with partial data.'
const SCORING_FAILURE_DETAIL =
  'We could not finish scoring this creative. No score is available for this review.'

/** Translate a producer-owned safe category into stable user-facing copy. */
function mediaFailureDetail(request: ProgressRequestRow): string {
  return request.media_processing_failure_code === 'media_processing_retries_exhausted'
    ? MEDIA_RETRIES_EXHAUSTED_DETAIL
    : MEDIA_FAILURE_DETAIL
}

// ---- media processing ----------------------------------------------------

/**
 * Did the pipeline get past media processing?
 *
 * This is the distinction that decides whether a failure is worth alarming the
 * user about. Migration 044's trigger fires the agents once every
 * `video_processing` row has left 'processing' — success **or** error — so a
 * video can fail some analysis tasks, still hand off, and still end up with a
 * scorecard built from partial data. `agents_triggered_at` is the guard column
 * that trigger stamps, so its presence is proof the handoff happened.
 *
 * Failure with the handoff => degraded, keep going.
 * Failure without it => the run stopped here.
 */
function agentsDispatched(request: ProgressRequestRow): boolean {
  return request.agents_triggered_at !== null
}

export function isFatalMediaFailure(request: ProgressRequestRow): boolean {
  return request.media_processing_status === 'failed' && !agentsDispatched(request)
}

function mediaUnit(request: ProgressRequestRow): ProgressUnit {
  // Labelled as the work, not the stage — the stage header above it already
  // says "Processing your video", and repeating it reads as a rendering bug.
  const base = { key: 'media', label: 'Preparing and analyzing', weight: MEDIA_WEIGHT }

  switch (request.media_processing_status) {
    case 'completed':
      return { ...base, status: 'success', detail: null }

    case 'failed':
      // Producer diagnostics stay internal. Users receive stable copy based on
      // the terminal state, while operators retain the raw error in `requests`.
      return agentsDispatched(request)
        ? { ...base, status: 'warning', detail: DEGRADED_MEDIA_DETAIL }
        : { ...base, status: 'error', detail: mediaFailureDetail(request) }

    case 'processing':
      // The worker only writes 'completed' after every analyzer has persisted
      // AND no analyzer errored (processor.py raises otherwise). So a run with a
      // failed task sits on 'processing' across retries even though its analysis
      // output is already final and the agents are away. Waiting for 'completed'
      // there would stall the bar for the rest of the run.
      if (agentsDispatched(request)) {
        return { ...base, status: 'success', detail: null }
      }
      return {
        ...base,
        status: 'processing',
        // Transient failures are recovered by the worker and evaluator layers.
        // They are intentionally invisible here unless recovery is exhausted.
        detail: null,
      }

    // 'pending', null, and anything a future migration adds. Unknown values fall
    // here rather than throwing: a status we do not recognise means we do not
    // know that work has started, which is what 'queued' says.
    default:
      return { ...base, status: 'queued', detail: null }
  }
}

// ---- evaluation ----------------------------------------------------------

function evaluationUnits(
  request: ProgressRequestRow,
  reported: ReadonlySet<string>,
): ProgressUnit[] {
  const fatal = isFatalMediaFailure(request)
  const dispatched = agentsDispatched(request)

  return EVALUATORS.map(({ key, label }) => {
    const base = { key, label, weight: EVALUATOR_WEIGHT }

    if (reported.has(key)) {
      // agent_results is PK (request_id, agent, metric_id) and migration 030
      // writes all of one agent's metrics inside a single transaction, so a
      // half-written agent is never observable. One row means it finished.
      return { ...base, status: 'success' as UnitStatus, detail: null }
    }
    if (fatal) {
      return { ...base, status: 'error' as UnitStatus, detail: SKIPPED_DETAIL }
    }
    // All seven are dispatched together in 044's loop, so once the handoff has
    // happened every evaluator without rows is genuinely in flight.
    return {
      ...base,
      status: (dispatched ? 'processing' : 'queued') as UnitStatus,
      detail: null,
    }
  })
}

// ---- scoring -------------------------------------------------------------

function scoringUnit(request: ProgressRequestRow, scored: boolean): ProgressUnit {
  const base = { key: 'scoring', label: 'Building your scorecard', weight: SCORING_WEIGHT }

  if (isFatalMediaFailure(request)) {
    return { ...base, status: 'error', detail: SKIPPED_DETAIL }
  }
  // 'completed' is accepted alongside the row itself because complete-evaluation
  // only marks completed after both projections succeeded. Requiring the row too
  // would flicker back to "processing" whenever the two queries in progress.ts
  // straddle that write.
  if (scored || request.evaluation_completion_status === 'completed') {
    return { ...base, status: 'success', detail: null }
  }

  switch (request.evaluation_completion_status) {
    case 'failed':
      return {
        ...base,
        status: 'error',
        detail: SCORING_FAILURE_DETAIL,
      }
    case 'pending':
    case 'processing':
      return { ...base, status: 'processing', detail: null }
    default:
      return { ...base, status: 'queued', detail: null }
  }
}

// ---- rollups -------------------------------------------------------------

/**
 * One status for a group of units — a whole video, or one check across the batch.
 *
 * Order matters: a group containing any hard failure is a failure, regardless of
 * what else finished. A fully finished group that contains a degraded unit is
 * itself degraded — otherwise a green tick would hide the warning underneath it.
 */
export function rollUpStatus(units: ProgressUnit[]): UnitStatus {
  if (units.length === 0) return 'queued'
  if (units.some((unit) => unit.status === 'error')) return 'error'
  if (units.every((unit) => isTerminal(unit.status))) {
    return units.some((unit) => unit.status === 'warning') ? 'warning' : 'success'
  }
  if (units.some((unit) => unit.status !== 'queued')) return 'processing'
  return 'queued'
}

function percent(units: ProgressUnit[]): number {
  const total = units.reduce((sum, unit) => sum + unit.weight, 0)
  if (total === 0) return 0

  const done = units
    .filter((unit) => isTerminal(unit.status))
    .reduce((sum, unit) => sum + unit.weight, 0)

  // Floor, not round. Rounding lets a large batch display "100% complete" while
  // work is still outstanding — at 13 weight per video, one unfinished unit in a
  // 16-video batch is only 0.5% of the total and rounds up. Flooring makes 100
  // reachable only when done === total, so the number can never contradict the
  // spinner next to it.
  return Math.floor((100 * done) / total)
}

function toStage(key: string, label: string, units: ProgressUnit[]): StageProgress {
  return { key, label, units, status: rollUpStatus(units) }
}

// ---- assembly ------------------------------------------------------------

/**
 * Why a video's run stopped, or null if it is fine or merely degraded.
 *
 * Deliberately derived from the row rather than by scanning units for an 'error'
 * — the skipped downstream units carry 'error' too, and reporting "Skipped"
 * as the reason would tell the user nothing about what actually broke.
 */
function fatalErrorFor(request: ProgressRequestRow): string | null {
  if (isFatalMediaFailure(request)) {
    return mediaFailureDetail(request)
  }
  if (request.evaluation_completion_status === 'failed') {
    return SCORING_FAILURE_DETAIL
  }
  return null
}

export function buildVideoProgress(
  request: ProgressRequestRow,
  reported: ReadonlySet<string>,
  scored: boolean,
  thumb: string = THUMBS[0],
): VideoProgress {
  const stages: StageProgress[] = [
    toStage('media', 'Processing your video', [mediaUnit(request)]),
    toStage('evaluation', 'Reviewing your creative', evaluationUnits(request, reported)),
    toStage('scoring', 'Scoring', [scoringUnit(request, scored)]),
  ]

  const units = stages.flatMap((stage) => stage.units)

  return {
    requestId: request.request_id,
    name: videoNameFromPaths(request.video_storage_paths),
    thumb,
    stages,
    pct: percent(units),
    status: rollUpStatus(units),
    isDone: units.every((unit) => isTerminal(unit.status)),
    fatalError: fatalErrorFor(request),
  }
}

export function buildBatchProgress(input: {
  requests: ProgressRequestRow[]
  agents: AgentResultRow[]
  scored: ScoredRequestRow[]
}): BatchProgress {
  const { requests, agents, scored } = input

  const reportedByRequest = new Map<string, Set<string>>()
  for (const row of agents) {
    const existing = reportedByRequest.get(row.request_id)
    if (existing) existing.add(row.agent)
    else reportedByRequest.set(row.request_id, new Set([row.agent]))
  }

  const scoredRequests = new Set(scored.map((row) => row.request_id))
  const empty: ReadonlySet<string> = new Set()

  const videos = [...requests]
    // Sorted by filename before tints are handed out, matching
    // assembleVideoResults exactly — that is what makes a video keep one colour
    // across the handoff from this screen to the ranking.
    .sort((a, b) =>
      videoNameFromPaths(a.video_storage_paths).localeCompare(
        videoNameFromPaths(b.video_storage_paths),
      ),
    )
    .map((request, index) =>
      buildVideoProgress(
        request,
        reportedByRequest.get(request.request_id) ?? empty,
        scoredRequests.has(request.request_id),
        THUMBS[index % THUMBS.length],
      ),
    )

  const allUnits = videos.flatMap((video) => video.stages.flatMap((stage) => stage.units))

  return {
    videos,
    pct: percent(allUnits),
    // An empty batch is not "done" — it is a batch id that matched nothing, and
    // reporting it complete would flip the page straight to an empty results view.
    isDone: videos.length > 0 && videos.every((video) => video.isDone),
    failed: videos.filter((video) => video.fatalError !== null),
  }
}
