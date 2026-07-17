# AdReady Score Engine Proposal v0.2
**Base:** Proposal v0.1 (Eval Strategy §8) + Scoring Engine architecture doc + discussion 2026-07-15

Legend: **`[OPEN]`** = tunable on golden set

**What changed vs v0.1**

| Area | v0.1 | v0.2 |
|------|------|------|
| Per-metric score | pass → full weight; fail → 0 | `metric_score = 100 − severity_deduction`; coef = score/100 |
| Overall % | Σ(weight if true) / Σ(weight) | Σ(weight × coef) / Σ(weight) over **8** scored metrics |
| UI dimensions | not defined | 8 scored metrics → 5 dims; **Visual** = `production_readiness` metric_score (**not** in Ad Ready %); still a gate |
| Fix list | gating → severity → weight | Score Engine owns sort (3 keys); ignore agent order |

---

## 1. Rubric v0.1 — 10 Metrics

| # | metric_id | Role |
|---|-----------|------|
| 1–8 | `brief_adherence`, `product_truth`, `product_clarity`, `audience_fit`, `brand_fit`, `cta_clarity`, `channel_readiness`, `creative_effectiveness` | **Scored** — Ad Ready % + dimension rollup |
| 9 | `production_readiness` | **Visual dimension score** + **gating**; weight **0** in Ad Ready % |
| 10 | `policy_compliance` | **Gating only** (no display dimension); weight 0 |

Agents emit all 10 with `metric_id`. `cannot_assess` → exclude from % / applicable dimension rollup.

---

## 2. Per-metric score (severity deduction)

Applies to **scored metrics (1–8)** for Ad Ready %, and to **`production_readiness`** for the Visual dimension bar. `policy_compliance` keeps `result`/`severity` for gating + fix list only.

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

## 3. Ad Readiness % (8 scored metrics)

Base weights (same as v0.1) `[OPEN]`:

| metric_id | Weight |
|-----------|--------|
| `brief_adherence` | 20 |
| `product_truth` | 20 |
| `product_clarity` | 15 |
| `audience_fit` | 10 |
| `brand_fit` | 10 |
| `cta_clarity` | 10 |
| `channel_readiness` | 10 |
| `creative_effectiveness` | 5 |
| **Total** | **100** |

`production_readiness` / `policy_compliance` weight = 0 → **not** in Ad Ready %.

```
Ad Readiness % =
  sum( weight_i × coef_i )  /  sum( weight_i )  × 100
  for applicable scored metrics 1–8 (result ≠ cannot_assess)
```

---

## 4. Display: → 6 dimensions

### Mapping

| Display dimension | Metrics | Dimension score |
|-------------------|---------|-----------------|
| Claims Accuracy | `product_truth` | that `metric_score` |
| Product Representation | `product_clarity` | that `metric_score` |
| Storyline & Brief | `brief_adherence`, `creative_effectiveness`, `channel_readiness` | weight-aware average |
| CTA Effectiveness | `cta_clarity` | that `metric_score` |
| Brand Alignment | `brand_fit`, `audience_fit` | weight-aware average |
| Visual / Asset Quality | `production_readiness` | that `metric_score` (0–100); **excluded from Ad Ready %** |

`policy_compliance` remains gating-only (no dimension bar).


### Merge rule — **weight-aware average**

```
dimension_score =
  sum( weight_j × metric_score_j ) / sum( weight_j )
  for applicable metrics j in that dimension
```

Visual: single metric → `dimension_score = production_readiness.metric_score` (no Ad Ready weight involved).  
One metric → that score. All `cannot_assess` in a dimension → Cannot Assess.

---

## 5. Gating & readiness status

**Gating failure when:**

```
metric_id ∈ {production_readiness, policy_compliance}
AND result = false
AND severity ∈ {high, critical}
```

Default: only these two gates (other metrics’ high/critical do not auto-gate).

| Status | Rule (same as v0.1) |
|--------|---------------------|
| Ready | No gating AND % ≥ **85** |
| Needs Revision | No gating AND % **65–84** |
| High Risk | Any gating OR % < **65** |
| Cannot Assess | Global inputs missing |

---

## 6. Priority fix list — Score Engine owns sort (3 keys)

Ignore agent list order. Candidates: all `result = false` metrics (including gates).

| Order | Key |
|-------|-----|
| 1 | **Gating failures** first |
| 2 | **Severity** critical → high → medium → low |
| 3 | Within same severity: **metric weight** desc |


Each item includes `metric_id`. Content from agent correction / explanation / owner when present.

---

## 7. Mini-example

Failures: `product_truth` critical, `cta_clarity` high, `brief_adherence` medium; `production_readiness` / `policy_compliance` = true (none).

| metric | severity | score | coef | w | w×coef |
|--------|----------|-------|------|---|--------|
| brief_adherence | medium | 80 | 0.80 | 20 | 16 |
| product_truth | critical | 0 | 0 | 20 | 0 |
| product_clarity | none | 100 | 1 | 15 | 15 |
| audience_fit | none | 100 | 1 | 10 | 10 |
| brand_fit | none | 100 | 1 | 10 | 10 |
| cta_clarity | high | 60 | 0.60 | 10 | 6 |
| channel_readiness | none | 100 | 1 | 10 | 10 |
| creative_effectiveness | none | 100 | 1 | 5 | 5 |
| production_readiness | none | 100 | — | 0 | *(Visual only)* |
| | | | | **100** | **72** |

**Ad Readiness % = 72**

### 6 display dimensions

| Dimension | Calc | Score |
|-----------|------|-------|
| Claims Accuracy | product_truth = 0 | **0** |
| Product Representation | product_clarity = 100 | **100** |
| Storyline & Brief | (20×80 + 5×100 + 10×100) / 35 | **≈ 88.6** |
| CTA Effectiveness | cta_clarity = 60 | **60** |
| Brand Alignment | (10×100 + 10×100) / 20 | **100** |
| Visual / Asset Quality | production_readiness = 100 | **100** |

**Status:** no gate, 72 ∈ 65–84 → **Needs Revision**  
**Fix order:** product_truth (critical) → cta_clarity (high) → brief_adherence (medium)

---


