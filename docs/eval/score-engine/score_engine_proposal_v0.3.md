# AdReady Score Engine Proposal v0.3
**Base:** Proposal v0.2 + Rubric v0.3 metric merge + confidence (issue-only) discussion 2026-07-24

Legend: **`[OPEN]`** = tunable on golden set


**What changed vs v0.2**

| Area | v0.2 | v0.3 |
|------|------|------|
| Rubric metrics | 10 (`audience_fit` + `channel_readiness` separate) | **9** — merge → `audience_channel_fit` |
| Scored metrics | 8 (weights sum 100) | **7** (weights sum 100); **Plan A** locked (Plan B kept as rejected alternative) |
| Storyline & Brief | brief + creative + `channel_readiness` | brief + creative + **`audience_channel_fit`** |
| Brand Alignment | `brand_fit` + `audience_fit` | **`brand_fit` only** |
| Confidence | not in proposal | **Issue / fix-list only**; does **not** affect scores |

Severity deductions, overall formula, gating, status thresholds, fix-list sort keys: **unchanged** from v0.2.

---

## 1. Rubric v0.3 — 9 Metrics

| # | metric_id | Role |
|---|-----------|------|
| 1–7 | `brief_adherence`, `product_truth`, `product_clarity`, `brand_fit`, `cta_clarity`, `creative_effectiveness`, `audience_channel_fit` | **Scored** — Ad Ready % + dimension rollup |
| 8 | `production_readiness` | **Visual dimension score** + **gating**; weight **0** in Ad Ready % |
| 9 | `policy_compliance` | **Gating only** (no display dimension); weight 0 |

**Removed vs v0.2:** `audience_fit`, `channel_readiness`.  
**Added:** `audience_channel_fit` — platform / placement / duration / viewing context **and** target audience needs/motivations (per Rubric v0.3 Channel / Placement question).

Agents emit all **9** with `metric_id`. `cannot_assess` → exclude from % / applicable dimension rollup.

---

## 2. Per-metric score (severity deduction)

Same as v0.2. Applies to **scored metrics (1–7)** for Ad Ready %, and to **`production_readiness`** for the Visual bar. `policy_compliance` keeps `result`/`severity` for gating + fix list only.

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

### Weights 

Merging removed 20 weight (`audience_fit` 10 + `channel_readiness` 10) and introduced `audience_channel_fit`. Scored sum remains **100**.

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

**Why Plan A:** After the merge, the `audience_channel_fit` question is not compressed. This metric still covers channel, placement, and audience, so it keeps a higher weight (**15**). Separately, `creative_effectiveness` was underweighted: even a severe creative failure barely moved the overall score or ship decision, so its weight increases by 5 (**5 → 10**).

#### Alternative considered (not selected): Plan B

Earlier draft: `audience_channel_fit` 10 · `cta_clarity` 15 · `creative_effectiveness` 10. Superseded by locked Plan A above.

---

## 4. Display: → 6 dimensions

### Mapping

| Display dimension | Metrics | Dimension score |
|-------------------|---------|-----------------|
| Claims Accuracy | `product_truth` | that `metric_score` |
| Product Representation | `product_clarity` | that `metric_score` |
| Storyline & Brief | `brief_adherence`, `creative_effectiveness`, **`audience_channel_fit`** | weight-aware average |
| CTA Effectiveness | `cta_clarity` | that `metric_score` |
| Brand Alignment | **`brand_fit` only** | that `metric_score` |
| Visual / Asset Quality | `production_readiness` | that `metric_score` (0–100); **excluded from Ad Ready %** |

`policy_compliance` remains gating-only (no dimension bar).

### Merge rule — **weight-aware average** (unchanged)

```
dimension_score =
  sum( weight_j × metric_score_j ) / sum( weight_j )
  for applicable metrics j in that dimension
```

Visual / single-metric dims → that `metric_score`. All `cannot_assess` in a dimension → Cannot Assess.

---

## 5. Gating & readiness status

Unchanged from v0.2.

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
| Cannot Assess | Global inputs missing |

---

## 6. Priority fix list — Score Engine owns sort (3 keys)

Unchanged from v0.2.

Candidates: all `result = false` metrics (including gates).  
**Not** candidates: `result = true` or `cannot_assess` (severity is `none` under contract → never on fix list when valid).

| Order | Key |
|-------|-----|
| 1 | **Gating failures** first |
| 2 | **Severity** critical → high → medium → low |
| 3 | Within same severity: **metric weight** desc |

Each item includes `metric_id`, plus agent correction / explanation / owner when present, and **confidence** (§7).

---

## 7. Confidence (issue / fix-list only)

### Principles

- Confidence is a **side-channel**. It does **not** change `metric_score`, Ad Ready %, dimension bars, gating, or status.
- UI surfaces (score table vs issue table):
  - **scores** → **no** confidence
  - **Issue / fix list** → **yes**, one level per issue

### Agent result

Optional on each metric row:

| Field | Values |
|-------|--------|
| `confidence` | `high` \| `medium` \| `low` |

If the field is **omitted** (old fixtures, partial agents, unlabeled golden), Score Engine normalizes to **`unknown`**. Do **not** invent `high`. UI may hide the badge or show “—” for `unknown`.

### How it appears on issues

- Fix list item confidence = that failed metric’s `confidence` (after omit → `unknown`).
- No multi-metric rollup: one issue ↔ one `metric_id` ↔ one level.
- `result = true` with low confidence does **not** create a fix-list row (not an “issue” under current rules).

---

## 8. Mini-example (Plan A)

Same failure pattern as v0.2, mapped to v0.3 ids: `product_truth` critical, `cta_clarity` high, `brief_adherence` medium; others pass; gates pass.

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

Storyline & Brief: `(20×80 + 10×100 + 15×100) / 45 ≈ 91.1`.  
Brand Alignment: `brand_fit = 100`.  
Fix order: product_truth → cta_clarity → brief_adherence (each may carry its own confidence badge).

---

## 9. Implementation / handoff notes

- Config companion: `score_config_v0.3.yaml` (Plan A locked).
- Code: `supabase/functions/_shared/score-engine/` implements v0.3 Plan A + issue confidence.
- Golden schema / agents contract: drop two ids, add `audience_channel_fit`; optional `confidence` on metrics.
- Related draft: `confidence_handling_plan.md` — **§7 here is normative**; dimension badges are not required.
