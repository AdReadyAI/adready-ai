# Score Engine (Eval)

Deterministic scoring for AdReady rubric metric results.  
**Design owner:** Leijie Tao · **Current version:** v0.3 only

## Contents

| File | Purpose |
|------|---------|
| `score_engine_proposal_v0.3.md` | Design proposal (normative scoring rules) |
| `score_config_v0.3.yaml` | Config companion (`active_weight_plan: A`) |


## Implementation

| Path | Role |
|------|------|
| `supabase/functions/_shared/score-engine/` | Pure Score Engine v0.3 + request parser |
| `supabase/functions/score-engine/` | Thin HTTP Edge Function (no DB writes) |
| `supabase/migrations/024_create_result_score_table.sql` | `result_score_table` + `result_score_dimensions` (pure columns) |
| `supabase/tests/functions/unit/` | Deno unit tests |

### Data flow

1. Agents emit **exactly nine** v0.3 `metric_results` (no scores); optional `confidence` / `explanation` / `recommended_fix` / `video_timestamp`.
2. Edge: validate → `scoreEngine()` → `{ result_table, issues }`.
3. Orchestrator: upsert `result_score_table` + six `result_score_dimensions` rows; insert each `issues[]` row into `issuetable`.
4. Frontend Result UI reads result score tables; Issue UI reads `issuetable`.

### DB ↔ API notes

- Dimension / overall `"Cannot Assess"` on the wire maps to SQL `NULL` scores.
- `request_id` / `batch_id` are SQL keys only (orchestrator); not inside Edge `result_table` JSON.

## Quick test (unit)

```bash
cd supabase
deno fmt --config deno.json --check
deno lint --config deno.json
deno task --config deno.json test:unit
```

## Local Edge Function (optional)

```bash
supabase functions serve score-engine --env-file supabase/.env.local
```

Request body must include all nine Rubric v0.3 metric ids (including `audience_channel_fit`). Mini-example expects `result_table.ad_readiness_pct` = 72, `Needs Revision`.
