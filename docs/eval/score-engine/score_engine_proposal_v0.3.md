# AdReady Score Engine Proposal v0.3

**Owned by:** Leijie Tao (Eval / Score Engine)  
**Status:** Current (sole) Score Engine design version  
**Companion config:** `score_config_v0.3.yaml`  
**Legend:** **`[OPEN]`** = tunable on golden set

Public API output shape: `{ result_table, issues }` (`ScoreTablesOutput`).  
Result UI / DB: `result_score_table` + `result_score_dimensions` (migration 024, pure columns).  
Issue UI / DB: `public.issuetable` (migration 025); engine emits `issues[]` with matching column names.  
Wire types: `ResultTable` / `IssueRow` / `ScoreTablesOutput` in `_shared/score-engine/types.ts`.

---

## 1. Rubric — 9 Metrics

| # | metric_id | Role |
|---|-----------|------|
| 1–7 | `brief_adherence`, `product_truth`, `product_clarity`, `brand_fit`, `cta_clarity`, `creative_effectiveness`, `audience_channel_fit` | **Scored** — Ad Ready % + dimension rollup |
| 8 | `production_readiness` | **Visual dimension score** + **gating**; weight **0** in Ad Ready % |
| 9 | `policy_compliance` | **Gating only** (no display dimension); weight 0 |

`audience_channel_fit` covers platform / placement / duration / viewing context **and** target audience needs/motivations (Rubric Channel / Placement). Legacy separate ids `audience_fit` / `channel_readiness` are **not** accepted.

Agents emit all **9** with `metric_id`. `cannot_assess` → exclude from % / applicable dimension rollup.

---

## 2. Per-metric score (severity deduction)

Applies to **scored metrics (1–7)** for Ad Ready %, and to **`production_readiness`** for the Visual bar. `policy_compliance` keeps `result`/`severity` for gating + fix list only.

| result | severity used |
|--------|---------------|
| `true` | always **`none`** |
| `false` | agent severity: low / medium / high / critical |
| `cannot_assess` | skip scoring |

### Deduction table `[OPEN]`

| severity | Deduction | metric_score | coef = score/100 |
|----------|-----------|--------------|------------------|
| `none` | 0 | 100 | 1.00 |
| `low` | 5 | 95 | 0.95 |
| `medium` | 20 | 80 | 0.80 |
| `high` | 40 | 60 | 0.60 |
| `critical` | 100 | 0 | 0.00 |

```
metric_score_i = 100 - deduction(severity_i)
coef_i         = metric_score_i / 100
```

---

## 3. Ad Readiness % (7 scored metrics)

```
Ad Readiness % =
  sum( weight_i × coef_i )  /  sum( weight_i )  × 100
  for applicable scored metrics 1–7 (result ≠ cannot_assess)
```

`production_readiness` / `policy_compliance` weight = 0 → **not** in Ad Ready %.  
Dimension totals do **not** drive overall % — only each metric’s own weight does.  
Public `result_table.ad_readiness_pct` is an **integer** 0–100 (or `null` when Cannot Assess).

### Weights (Plan A, locked)

Scored sum = **100**.

| metric_id | Weight |
|-----------|--------|
| `brief_adherence` | 20 |
| `product_truth` | 20 |
| `product_clarity` | 15 |
| `audience_channel_fit` | **15** |
| `brand_fit` | 10 |
| `cta_clarity` | 10 |
| `creative_effectiveness` | **10** |
| **Total** | **100** |

**Why Plan A:** `audience_channel_fit` still covers channel, placement, and audience, so it keeps weight **15**. `creative_effectiveness` was underweighted for ship decisions, so it is **10**.

#### Alternative considered (not selected): Plan B

`audience_channel_fit` 10 · `cta_clarity` 15 · `creative_effectiveness` 10. Superseded by Plan A.

---

## 4. Display → 6 dimensions

### Mapping

| Display dimension | Metrics | Dimension score |
|-------------------|---------|-----------------|
| Claims Accuracy | `product_truth` | that `metric_score` |
| Product Representation | `product_clarity` | that `metric_score` |
| Storyline & Brief | `brief_adherence`, `creative_effectiveness`, `audience_channel_fit` | weight-aware average |
| CTA Effectiveness | `cta_clarity` | that `metric_score` |
| Brand Alignment | `brand_fit` only | that `metric_score` |
| Visual / Asset Quality | `production_readiness` | that `metric_score` (0–100); **excluded from Ad Ready %** |

`policy_compliance` remains gating-only (no dimension bar).

### Merge rule — weight-aware average

```
dimension_score =
  sum( weight_j × metric_score_j ) / sum( weight_j )
  for applicable metrics j in that dimension
```

Visual / single-metric dims → that `metric_score`.  
All `cannot_assess` in a dimension → public score **`"Cannot Assess"`** (integer otherwise).

Frontend display order/labels may differ; match rows by dimension `id`.

---

## 5. Gating & readiness status

```
metric_id ∈ {production_readiness, policy_compliance}
AND result = false
AND severity ∈ {high, critical}
```

| Status | Rule |
|--------|------|
| Ready | No gating AND % ≥ **85** |
| Needs Revision | No gating AND % **65–84** |
| High Risk | Any gating OR % < **65** |
| Cannot Assess | No applicable scored weight (and no gating) |

---

## 6. Priority fix list — Score Engine owns sort (3 keys)

Candidates: all `result = false` metrics (including gates).  
**Not** candidates: `result = true` or `cannot_assess`.

| Order | Key |
|-------|-----|
| 1 | **Gating failures** first |
| 2 | **Severity** critical → high → medium → low |
| 3 | Within same severity: **metric weight** desc |

Each issue includes `metric_id`, `title`, `severity`, `confidence`, and optional
`detail` / `repair_suggestion` / `video_timestamp` (issuetable column names).  
Agent input may still use `explanation` / `recommended_fix`; the engine renames on output.  
Public payload: `issues[]` (array order = priority). Orchestrator adds `request_id` / `batch_id` on INSERT.

---

## 7. Confidence (issue / fix-list only)

### Agent field

Optional on each metric row:

| Field | Values |
|-------|--------|
| `confidence` | `high` \| `medium` \| `low` |

If **omitted**, Score Engine normalizes to **`unknown`**. Do **not** invent `high`. UI may hide the badge or show “—” for `unknown`.

### On issues

- Fix-list item confidence = that failed metric’s `confidence` (after omit → `unknown`).
- One issue ↔ one `metric_id` ↔ one level (no multi-metric rollup).
- `result = true` with low confidence does **not** create a fix-list row.

Fix-list sort stays gating → severity → weight. Confidence is **not** a sort key.

---

## 8. Mini-example (Plan A)

Failures: `product_truth` critical, `cta_clarity` high, `brief_adherence` medium; others pass; gates pass.

| metric | severity | score | coef | w | w×coef |
|--------|----------|-------|------|---|--------|
| brief_adherence | medium | 80 | 0.80 | 20 | 16 |
| product_truth | critical | 0 | 0 | 20 | 0 |
| product_clarity | none | 100 | 1 | 15 | 15 |
| brand_fit | none | 100 | 1 | 10 | 10 |
| cta_clarity | high | 60 | 0.60 | 10 | 6 |
| creative_effectiveness | none | 100 | 1 | 10 | 10 |
| audience_channel_fit | none | 100 | 1 | 15 | 15 |
| | | | | **100** | **72** |

**Ad Readiness % = 72** → Needs Revision (no gate).  
Storyline & Brief ≈ 91.1 → public integer **91**.  
Fix order: product_truth → cta_clarity → brief_adherence (each may carry confidence).

---

## 9. Implementation / handoff

| Artifact | Role |
|----------|------|
| `score_config_v0.3.yaml` | Machine-readable companion (Plan A locked) |
| `supabase/functions/_shared/score-engine/` | Pure Score Engine + parser |
| `supabase/functions/score-engine/` | Thin Edge: POST → `{ result_table, issues }` |
| `024_create_result_score_table.sql` | `result_score_table` + `result_score_dimensions` (pure columns) |
| `_shared/score-engine/types.ts` | Edge/API TypeScript shapes (`ResultTable`, `IssueRow`, …) |
| `025` / `public.issuetable` | Issue rows (engine does not write this table) |

Orchestrator writes result columns and issue rows; Edge does not write Postgres.

