# Score Engine (Eval)

Deterministic scoring for AdReady Rubric v0.1 metric results.

## Contents

| File | Purpose |
|------|---------|
| `score_engine_proposal_v0.2.md` | Design proposal (human-readable) |
| `score_config_v0.2.yaml` | Tunable weights, deductions, thresholds, dimensions |

## Implementation

TypeScript lives under Supabase shared code (for future Edge Functions):

`supabase/functions/_shared/score-engine/`

Unit tests:

`supabase/tests/functions/unit/score_engine_test.ts`

- Agents emit `metric_results` only (no scores).
- Score Engine owns Ad Readiness %, status, 6 display dimensions, gating, and fix-list sort.
- No HTTP Edge Function in this branch — pure module + Deno unit tests only.

## Quick test

```bash
cd supabase
deno task --config deno.json test:unit
```
