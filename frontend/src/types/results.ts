export type ShipStatus = 'ready' | 'revision' | 'nope'
export type Severity = 'high' | 'medium'

export interface Metric {
  label: string
  /** 0–100 */
  value: number
}

export interface Issue {
  id: string
  /** e.g. "0:03" */
  timestamp: string
  /** small badge next to the timestamp, e.g. "Unsupported Claim" */
  tag: string
  /** trailing header title, e.g. "Claim Review" */
  title: string
  severity: Severity
  /** shown as its own pill in the collapsed header when set */
  severityLabel?: string
  detail: string
  frameLabel: string
  repairTitle: string
  repairText: string
}

export interface VideoResult {
  rank: number
  name: string
  /** 0–100 overall launch-readiness score */
  score: number
  status: ShipStatus
  thumb: string // tailwind bg class for the thumbnail
  metrics: Metric[]
  summary: string
  issues: Issue[]
}
