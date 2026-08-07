export type UnitStatus = 'queued' | 'processing' | 'success' | 'error'

export interface ProgressUnit {
  request_id: string
  batch_id: string
  stage_key: string
  stage_order: number
  unit_key: string
  display_name: string
  sort_order: number
  weight: number
  status: string     // widened on purpose — see note
}

// `status` stays `string`, not the `UnitStatus` union. The DB's CHECK
// constraint has already changed once (042 added 'processing'); a narrow
// union would make the next addition a type error instead of a graceful
// degrade. Treat anything not in a terminal-statuses set as "not done".
