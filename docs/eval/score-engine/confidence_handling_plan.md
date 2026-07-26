# Confidence Handling Plan (Draft)

**Status:** Partially superseded for product rules by **`score_engine_proposal_v0.3.md` §7**.  
Keep this file for background / trade-off notes. **Normative v0.3 decisions:**

- Confidence on **issue / fix list only** (not on overall % or dimension scores).
- Levels: `high` \| `medium` \| `low`; omitted field → `unknown`.
- No dimension worst-link badge required for v0.3 UI.

---

## 1. Goal

Agents may return a confidence signal with each **metric**. Product UI may primarily show the **6 display dimensions**, not the 10 raw metrics. Users still need to **see uncertainty**, especially when assessment “passed” (`result=true` / `severity=none`) but the model is unsure.

Hard constraint (agreed):

- Confidence is a **side-channel / trust signal**.
- It must **not** change:
  - per-metric `metric_score` / coef
  - Ad Readiness %
  - display dimension **numeric** scores
  - gating thresholds (unless product later opts in — default **no**)

Rationale: deducting from a dimension bar when the underlying metrics “passed” would look like a scoring bug.

---

## 2. What agents emit

Confidence is still authored **per metric** (agents do not invent dimension-level confidence):

| Field | Type | Notes |
|-------|------|--------|
| `confidence` | `high` \| `medium` \| `low` | Discrete levels only for v1 |

**Not in v1 plan:**

- Continuous 0–1 or 0–100% as the primary agent contract.
- Averaging confidences into one “final score confidence %”.

If an agent omits `confidence`, treat as **`unknown`** (do not invent `high`).

Score Engine **derives** a dimension-level confidence badge for UI (see §4).

---

## 3. What Score Engine does vs does not do

### Does **not** do (non-scoring)

| Action | Decision |
|--------|----------|
| Fold confidence into weights | No |
| Reduce `metric_score` when `true` + `low` | No |
| Soften / harden dimension **numeric** rollup | No |
| Change Ready / Needs Revision / High Risk from confidence alone | No |
| Auto-gate on low confidence | No (default) |

### Does do (passthrough + rollup + summary)

1. **Validate** optional `confidence` on each metric input.
2. **Passthrough** metric-level `confidence` on `metric_results` (and fix-list items when useful).
3. **Attach** `confidence` (and optional detail) on each **dimension** object in the output for UI badges.
4. **Emit** a review-level `confidence_summary` (counts + low metric / dimension ids).

```ts
// On each dimension (alongside existing score):
confidence: "high" | "medium" | "low" | "unknown";
confidence_members?: Array<{
  metric_id: MetricId;
  confidence: "high" | "medium" | "low" | "unknown";
}>; // optional; helps expand/tooltip when UI only shows dimensions

confidence_summary: {
  high: number;
  medium: number;
  low: number;
  unknown: number;
  low_confidence_metric_ids: MetricId[];
  low_confidence_dimension_ids: string[];
};

needs_human_review?: boolean; // e.g. any low
```

Fix-list sort: keep gating → severity → weight. Confidence tie-break is optional later.

---

## 4. UI: dimension-first badges

### 4.1 Answer: yes — primary badge lives on each of the 6 dimensions

If the results page only shows the 6 dimensions, confidence should appear as a **badge next to each dimension** (High / Medium / Low / Unknown), **without** changing the dimension’s numeric score.

| Surface | Role |
|---------|------|
| **6 dimension rows** | **Primary** confidence UX for v1 product UI |
| Metric drill-down / tooltip | Secondary: show member metrics when user expands or hovers |
| Fix list (if shown) | Per-issue metric confidence still useful |
| Ad Ready % | No confidence %; optional review banner only |

### 4.2 How dimensions map to metrics (v0.2)

| Dimension | Member metrics | Merge for **score** | Merge for **confidence badge** |
|-----------|----------------|---------------------|--------------------------------|
| Claims Accuracy | `product_truth` | single score | = that metric’s confidence |
| Product Representation | `product_clarity` | single | = that metric |
| Storyline & Brief | `brief_adherence`, `creative_effectiveness`, `channel_readiness` | weight-aware average of scores | **rollup rule below** |
| CTA Effectiveness | `cta_clarity` | single | = that metric |
| Brand Alignment | `brand_fit`, `audience_fit` | weight-aware average | **rollup rule below** |
| Visual / Asset Quality | `production_readiness` | single (UI only) | = that metric |

`cannot_assess` members are excluded from the dimension **score** today; exclude them from confidence rollup the same way (only applicable members). If **all** members are `cannot_assess` / missing, dimension confidence = `unknown`.

### 4.3 Multi-metric dimension: recommended rollup = **worst applicable level**

Confidence order (worst → best):

`low` < `medium` < `high`, and `unknown` does **not** upgrade a known level.

**Recommended v1 rule (pessimistic / “weakest link”):**

```
dimension_confidence =
  worst( confidence of applicable member metrics )
  where worst ignores `unknown` if any known level exists;
  if all unknown → `unknown`
```

Examples (Storyline & Brief):

| Members | Dimension badge | Why |
|---------|-----------------|-----|
| high, high, high | **high** | all clear |
| high, medium, high | **medium** | one weaker link |
| high, low, medium | **low** | any low dominates |
| high, unknown, high | **high** | unknown ignored when others known |
| unknown, unknown | **unknown** | nothing to report |

**Do not** use weight-aware average of confidence for the badge (scores already use weights; mixing “trust” into a pseudo-average % confuses users and fights the non-scoring rule).

### 4.4 Optional UI detail for merged dimensions

When badge ≠ all members equal, UI can:

- Tooltip: “Brand Alignment: brand_fit high · audience_fit low”
- Or chevron expand listing `confidence_members`

Score Engine should provide `confidence_members` so frontend does not re-implement mapping.

---

## 5. Alternatives considered (trade-offs)

### A. Badge only on metrics (no dimension rollup)

| Pros | Cons |
|------|------|
| Honest to agent output; no rollup policy debate | **Fails** if UI only shows 6 dimensions — confidence invisible |
| Simpler engine | Product cannot surface “uncertain Storyline” without metric page |

**Verdict:** insufficient as sole UX if dimensions are the main surface.

### B. Dimension badge = worst member (recommended)

| Pros | Cons |
|------|------|
| Matches “trust the weakest evidence in this bar” | Multi-metric dims look “low” even if 2/3 members are high |
| Simple, deterministic, easy to explain | Feels harsh vs average; needs tooltip to avoid “why is this red?” |
| Aligns with safety / review mindset | — |

**Verdict:** **default for v1**.

### C. Dimension badge = majority / median of members

| Pros | Cons |
|------|------|
| Less noisy for 3-metric dims | Hides a single critical low-confidence member |
| — | Harder to explain than worst-link; odd with 2-metric dims (tie) |

**Verdict:** reject for v1; revisit only if worst-link causes too many review flags.

### D. Dimension badge = weight-aware “soft” confidence %

| Pros | Cons |
|------|------|
| Parallel to score merge | Looks like a second score; users mix it with the bar |
| — | Violates spirit of non-scoring side-channel; calibration pain |

**Verdict:** reject.

### E. Only a single page-level confidence (no per-dimension)

| Pros | Cons |
|------|------|
| Minimal UI chrome | User cannot see **which** dimension is uncertain |
| — | Weak for “passed but unsure on Claims” cases |

**Verdict:** optional **banner** only; not a replacement for dimension badges.

### F. Fold low confidence into dimension numeric score

| Pros | Cons |
|------|------|
| Forces attention via the bar | **Rejected** — `true` + low would lower a “passed” dimension and confuse users |

---

## 6. Edge cases

| Case | Behavior |
|------|----------|
| `true` + `none` + `low` on a single-metric dim | Full dimension score; badge **low** |
| Multi-metric dim, one member `low`, others `high` | Score unchanged (weight-aware average of scores); badge **low**; tooltip lists members |
| Member `cannot_assess` | Skip for score and for confidence rollup |
| All members `unknown` | Dimension badge `unknown` |
| Review-level banner | Driven by any dimension/metric `low` (tunable) |

---

## 7. Implementation sketch (when we code)

1. Types + parser — optional metric `confidence`.
2. `scoreEngine` — passthrough; compute per-dimension `confidence` via worst-link; fill `confidence_members` + `confidence_summary`.
3. Unit tests — multi-metric dim rollup cases; assert **numeric** scores unchanged when only confidence changes.
4. Frontend — dimension badge + tooltip; optional page banner.
5. Proposal update — deferred until this plan is approved.

No confidence weights in `score_config_v0.2.yaml` for v1.  
Optional later config: rollup mode (`worst` \| `majority`), `needs_human_review` threshold.

---

## 8. Decision log

| Decision | Choice |
|----------|--------|
| Scoring impact | None (numbers unchanged) |
| Agent grain | Per **metric** |
| Primary UI grain | Per **dimension** badge (6 dims) |
| Multi-metric rollup | **Worst applicable** known level (`unknown` ignored if any known) |
| Extra detail | `confidence_members` for tooltip/expand |
| Final-score confidence % | No |
| Proposal update | Deferred |

---

## 9. Open questions (parked)

1. Does `medium` set `needs_human_review`, or only `low`?
2. Tooltip always, or only when members disagree?
3. Should Visual (gating + UI score) use the same badge rules as scored dims? (Recommend **yes**.)
4. Golden labels: require metric confidence or leave optional?

---

## 10. Out of scope

- Editing `score_engine_proposal_v0.2.md` until requested  
- Changing severity / threshold math  
- Edge auth / DB persistence  
- Pixel-level badge design  
