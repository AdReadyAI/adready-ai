# Score Engine (Eval)

Deterministic scoring for AdReady rubric metric results.

## Contents

| File | Purpose |
|------|---------|
| `score_engine_proposal_v0.2.md` | Design proposal v0.2 (preserved) |
| `score_config_v0.2.yaml` | Config v0.2 (preserved) |
| `score_engine_proposal_v0.3.md` | Design proposal v0.3 — 9 metrics, Plan A weights, issue confidence |
| `score_config_v0.3.yaml` | Config v0.3 companion (`active_weight_plan: A`) |
| `confidence_handling_plan.md` | Earlier confidence UX draft; **v0.3 §7 is normative** (fix-list only) |

## Implementation

| Path | Role |
|------|------|
| `supabase/functions/_shared/score-engine/` | Pure Score Engine v0.3 + request parser |
| `supabase/functions/score-engine/` | Thin HTTP Edge Function (no DB writes) |
| `supabase/tests/functions/unit/` | Deno unit tests |

- Agents emit `metric_results` only (no scores); optional `confidence` on metrics.
- Score Engine owns Ad Ready %, status, 6 display dimensions, gating, fix-list sort, and fix-list confidence passthrough.
- Edge Function is a stateless wrapper: validate body → `scoreEngine()` → JSON.

## Quick test (unit)

```bash
cd supabase
deno fmt --config deno.json --check
deno lint --config deno.json
deno task --config deno.json test:unit
```

## Local Edge Function (optional)

With local Supabase running:

```bash
supabase functions serve score-engine --env-file supabase/.env.local
```

Use Rubric v0.3 metric ids (including `audience_channel_fit`; no `audience_fit` / `channel_readiness`). Mini-example expects `ad_readiness_pct` ≈ 72, `Needs Revision`.
