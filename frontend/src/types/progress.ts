// Shapes for the loading experience — what the pipeline is doing right now, for
// one batch.
//
// Every value here is derived from rows the pipeline already writes. Nothing is
// a hand-maintained "percent done" column, so the number on screen cannot drift
// away from reality. The derivation itself lives in lib/progressTransform.ts.

/**
 * How one unit of pipeline work is doing.
 *
 * `warning` is the one that is easy to get wrong. It means **finished, but
 * degraded**: some analysis steps failed, yet the pipeline carried on and this
 * video will still get a score. That is a real state, not a hypothetical —
 * migration 044's trigger fires the agents once every `video_processing` row has
 * left 'processing', "whether it landed on 'success' or 'error'". Rendering that
 * as `error` would tell the user their review died when it is still running.
 *
 * `error` is reserved for work that genuinely stopped.
 */
export type UnitStatus = 'queued' | 'processing' | 'success' | 'warning' | 'error'

/**
 * Statuses that mean "this unit will not change again".
 *
 * Single source of truth for the word "done". The progress percentage, the
 * per-video pill, and the decision to leave the loading screen entirely all read
 * this one set — so they cannot disagree about whether a run has finished.
 */
export const TERMINAL_STATUSES: ReadonlySet<UnitStatus> = new Set<UnitStatus>([
  'success',
  'warning',
  'error',
])

export function isTerminal(status: UnitStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** The smallest thing the checklist can tick off. */
export interface ProgressUnit {
  /** Stable key for React and for tests. Not shown. */
  key: string
  /** Row title in the checklist. */
  label: string
  /**
   * Share of the progress bar this unit is worth.
   *
   * Weighted rather than equal-counted because the steps are wildly different
   * lengths: media processing is minutes of real work, writing the scorecard is
   * one insert. Equal counts would park the bar for the entire wait and then jump.
   */
  weight: number
  status: UnitStatus
  /**
   * Why, in the user's words — an error message, a retry note, or null.
   *
   * Comes from `requests.media_processing_error` /
   * `requests.evaluation_completion_last_error`, which are written by the worker
   * and the completion function respectively. Raw producer text: useful, but
   * never assume it is short or friendly.
   */
  detail: string | null
}

/** A named group of units — one row of the pipeline, as the user thinks of it. */
export interface StageProgress {
  key: string
  label: string
  units: ProgressUnit[]
  /** Rolled up from `units`. See rollUpStatus in progressTransform.ts. */
  status: UnitStatus
}

/** One video's journey through the pipeline. `requests` is one row per video. */
export interface VideoProgress {
  requestId: string
  /** Filename from `video_storage_paths[0]`, same derivation the results view uses. */
  name: string
  /**
   * Tailwind classes for the thumbnail tile.
   *
   * Assigned by the same rule as the ranking cards, so a video keeps one colour
   * from the loading screen through to its result.
   */
  thumb: string
  stages: StageProgress[]
  /** 0-100, weighted across this video's units. */
  pct: number
  /** Rolled up from every unit — what the card's pill says. */
  status: UnitStatus
  isDone: boolean
  /**
   * Set only when this video's pipeline **stopped**.
   *
   * A degraded run that still produced a score reports its failure through
   * `warning` units instead, so this field answers exactly one question: is
   * there going to be a result for this video or not?
   */
  fatalError: string | null
}

export interface BatchProgress {
  videos: VideoProgress[]
  // Deliberately no batch-level rollup of the checks. It was tried, and it lies:
  // with one failed video out of four, every row collapses to red "Skipped"
  // while the other three are running along fine. Videos in a batch have
  // genuinely different fates, so the checklist belongs per video.
  /** 0-100, weighted across every unit of every video in the batch. */
  pct: number
  /** Every video done. This is what releases the loading screen. */
  isDone: boolean
  /** Videos whose pipeline stopped. Empty on a healthy run. */
  failed: VideoProgress[]
}
