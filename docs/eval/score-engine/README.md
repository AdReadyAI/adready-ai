# Score Engine (Eval)

Deterministic scoring for AdReady Rubric v0.1 metric results.

## Contents

| File | Purpose |
|------|---------|
| `score_engine_proposal_v0.2.md` | Design proposal (human-readable) |
| `score_config_v0.2.yaml` | Tunable weights, deductions, thresholds, dimensions |

## Implementation

| Path | Role |
|------|------|
| `supabase/functions/_shared/score-engine/` | Pure Score Engine + request parser |
| `supabase/functions/score-engine/` | Thin HTTP Edge Function (no DB writes) |
| `supabase/tests/functions/unit/` | Deno unit tests |

- Agents emit `metric_results` only (no scores).
- Score Engine owns Ad Readiness %, status, 6 display dimensions, gating, and fix-list sort.
- Edge Function is a stateless wrapper: validate body → `scoreEngine()` → JSON.

## Quick test (unit)

```bash
cd supabase
deno task --config deno.json test:unit
```

## Local Edge Function (optional)

With local Supabase running:

```bash
supabase functions serve score-engine --env-file supabase/.env.local
```

Example request:

```bash
curl -s -X POST "http://127.0.0.1:54321/functions/v1/score-engine" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ANON_OR_SERVICE_KEY>" \
  -d '{
    "metric_results": [
      { "metric_id": "brief_adherence", "result": "false", "severity": "medium" },
      { "metric_id": "product_truth", "result": "false", "severity": "critical" },
      { "metric_id": "product_clarity", "result": "true", "severity": "none" },
      { "metric_id": "audience_fit", "result": "true", "severity": "none" },
      { "metric_id": "brand_fit", "result": "true", "severity": "none" },
      { "metric_id": "cta_clarity", "result": "false", "severity": "high" },
      { "metric_id": "channel_readiness", "result": "true", "severity": "none" },
      { "metric_id": "creative_effectiveness", "result": "true", "severity": "none" },
      { "metric_id": "production_readiness", "result": "true", "severity": "none" },
      { "metric_id": "policy_compliance", "result": "true", "severity": "none" }
    ]
  }'
```

Expected: `ad_readiness_pct` ≈ 72, `readiness_status` = `Needs Revision`.
