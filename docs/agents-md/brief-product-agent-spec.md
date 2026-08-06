# Brief Alignment and Product Representation Agent Integration

**Status:** Proposed\
**Branch:** `integrate-brief-product-agents`\
**Baseline:** `origin/main` at `3afc7df`\
**Source:** Selective integration of PR #41 (`product/brief-`)

## 1. Purpose

This specification defines the MVP implementation and integration contract for
the Brief Alignment and Product Representation evaluator Edge Functions.

The two evaluators consume the shared, database-loaded `AgentContext`, produce
atomic metric judgments, and persist normalized results. They do not calculate
the final Launch-Readiness Scorecard, combine cross-agent metrics, or write the
Result UI tables.

## 2. Domain terms

- **Atomic judgment:** One evaluator's focused assessment of one review
  criterion. `audience_fit` and `channel_readiness` are separate atomic
  judgments.
- **Composite metric:** A scored metric derived downstream from multiple atomic
  judgments. `audience_channel_fit` combines `audience_fit` and
  `channel_readiness`.
- **Display dimension:** A user-facing grouping of scored metrics. The broader
  alignment dimension may combine `brief_adherence`, `brand_fit`, and the
  downstream `audience_channel_fit` composite without changing ownership of the
  underlying judgments.

## 3. Scope

### In scope

- Implement the Brief Alignment Edge Function.
- Implement the Product Representation Edge Function.
- Use the shared internal-trigger, context-loading, validation, and persistence
  modules from current `main`.
- Port useful evaluator behavior and tests from PR #41 while adapting them to
  the current database schema.
- Persist the following atomic metric rows:
  - `brief_adherence`
  - `audience_fit`
  - `product_clarity`

### Out of scope

- Combining `audience_fit` with `channel_readiness`.
- Producing `audience_channel_fit`.
- Waiting for all evaluator invocations to complete.
- Calling the Score Engine.
- Writing `result_score_table`, `result_score_dimensions`, or `issues`.
- Changing the scoring weights or display-dimension formulas.
- Reworking other evaluator implementations.
- Adding benchmark, seed, or generated evaluation-bundle data from PR #41.

The future downstream database-trigger work owns aggregation, Score Engine
invocation, and Result UI persistence.

## 4. Runtime flow

Migration `044_trigger_agents_on_processing_complete.sql` invokes each evaluator
after Media Processing completes. Calls contain:

```json
{
  "request_id": "<uuid>"
}
```

The request carries `Authorization: Bearer <INTERNAL_TRIGGER_SECRET>` and does
not carry an authenticated user's JWT. Both evaluator entrypoints must therefore
use `createInternalEdgeHandler`, not `createEdgeHandler`.

Each evaluator follows the same lifecycle:

1. Validate the internal trigger secret and `AgentRunRequestSchema` body.
2. Call `loadAgentContext(request_id)` without a `userId` filter.
3. Evaluate only its owned metrics.
4. Validate the complete result array with `validateMetricResults`.
5. Persist the complete invocation with `persistMetricResults`.
6. Return the validated metric array.

The entrypoint is a thin adapter. Evaluation and roll-up behavior belongs behind
an agent module interface that accepts `AgentContext` and returns
`Promise<MetricResult[]>`.

## 5. Migration-backed input contract

The evaluators consume the `AgentContext` returned by the shared loader. They do
not query source tables directly.

Relevant effective database relationships are:

- `requests.request_id` identifies one Ad Creative review.
- `requests.batch_id` resolves the batch-scoped `parsed_creative_briefs` row.
- `video_processing.id` scopes transcript, visual, product, and logo processing
  outputs by task.
- `visual_frames` exposes `action` and `framing_composition`; the removed
  `visual_description` and `camera_movement` columns must not be referenced.
- `product_frames` is processing-scoped and has no `request_id` or
  `usage_context` column.
- `logo_frames` is processing-scoped.
- `ocr_segments` remains request-addressable through the shared loader.
- evaluator results are persisted to `agent_results`, `agent_result_evidence`,
  and `agent_result_sub_checks` through the atomic
  `replace_agent_metric_results` database function.

Missing optional evidence collections are valid inputs. A missing required
Review Input must produce a controlled `cannot_assess` judgment or a controlled
request failure according to the rules below; it must not cause the evaluator to
invent evidence.

## 6. Shared output invariants

Every emitted `MetricResult` must satisfy the current shared evaluator contract:

| Result          | Severity                               |
| --------------- | -------------------------------------- |
| `true`          | `none`                                 |
| `false`         | `low`, `medium`, `high`, or `critical` |
| `cannot_assess` | `cannot_assess`                        |

Every sub-check must satisfy:

| Result          | Severity                               |
| --------------- | -------------------------------------- |
| `passed`        | `none`                                 |
| `failed`        | `low`, `medium`, `high`, or `critical` |
| `cannot_assess` | `cannot_assess`                        |

Additional invariants:

- A metric fails when at least one assessable owned sub-check fails.
- Metric severity is the highest severity among its failed sub-checks.
- A metric passes when at least one owned sub-check is assessable and every
  assessable owned sub-check passes.
- A metric is `cannot_assess` only when none of its owned sub-checks can be
  assessed.
- A passing or unassessable metric has `correction_type: "none"` and no
  `suggested_correction`.
- A failing metric may include one actionable correction derived from its failed
  sub-checks.
- Missing evidence must not be converted into a pass or failure. It lowers
  confidence or makes the affected sub-check unassessable.
- Model-provided correction text alone must never change a result from pass to
  fail.

The downstream aggregation adapter is responsible for translating evaluator
storage semantics if the Score Engine requires a different representation for
`cannot_assess` severity.

## 7. Brief Alignment Agent

### Interface

```ts
runBriefAlignmentAgent(
  context: AgentContext,
  chatFn?: BriefAlignmentChat,
): Promise<MetricResult[]>
```

The returned array contains exactly two rows in this order:

1. `brief_adherence`
2. `audience_fit`

The persisted `agent` value is `brief_alignment`.

### `brief_adherence`

Question: Does the Ad Creative satisfy the campaign objective and required
messages in its Creative Brief?

Owned sub-checks:

- `objective_missed`: The communicated objective conflicts with or fails to
  support the Campaign Goal and brief objective.
- `required_message_missing`: One or more required messages are absent or too
  weak to communicate their intended meaning.

Primary inputs:

- `campaign_goal`
- `parsed_creative_brief.raw_text`
- `parsed_creative_brief.required_messages`
- transcript segments
- OCR segments
- visual-frame `action` and `framing_composition`
- product frames when a required message depends on showing the product

If neither a usable campaign objective nor required message exists, the relevant
sub-check is `cannot_assess`; the agent must not invent requirements from
generic advertising practice.

### `audience_fit`

Question: Does the Ad Creative speak to the intended audience's needs,
motivations, and context?

Owned sub-checks:

- `demographic_mismatch`: Tone, vocabulary, people, setting, or use case clashes
  with the stated target audience.
- `demographic_restricted`: The targeting or creative treatment is inappropriate
  for an explicitly stated restricted audience.

Primary inputs:

- `parsed_creative_brief.target_audience`
- `parsed_creative_brief.raw_text`
- transcript and OCR language
- visual-frame people, action, background, palette, and composition
- `campaign_goal` when it materially changes the intended audience context

If the Creative Brief does not identify a target audience, both audience
sub-checks are `cannot_assess` unless another explicit Campaign Context field
provides that audience. The agent must not infer a demographic solely from the
people detected in the Ad Creative.

### Boundary with other agents

- Brief Alignment does not emit `audience_channel_fit`.
- Brief Alignment does not judge platform format, placement conventions, or
  duration; those belong to Storyline Clarity's `channel_readiness` judgment.
- Brief Alignment may use brand voice as Campaign Context for audience or brief
  interpretation, but it does not emit `brand_fit` or duplicate Brand
  Alignment's logo, palette, or brand-voice checks.

## 8. Product Representation Agent

### Interface

```ts
runProductRepresentationAgent(
  context: AgentContext,
  chatFn?: ProductRepresentationChat,
): Promise<MetricResult[]>
```

The returned array contains exactly one `product_clarity` row. The persisted
`agent` value is `product_representation`.

Question: Can a viewer clearly identify the product being advertised?

Owned sub-checks:

- `product_not_shown`: No product unit, packaging, or other sufficiently
  grounded product representation is present.
- `product_obscured`: The product is detected but is too cropped, small,
  blurred, or visually obstructed to identify reliably.
- `product_appearance_wrong`: Available evidence conflicts with supplied Product
  References.
- `product_name_unspoken`: The product or brand name is absent from both spoken
  and on-screen language when naming is needed for identification.

Primary inputs:

- product frames and their prominence, focus, framing, and timestamps
- matching visual-frame `action` and `framing_composition`
- logo frames and reference-match signals
- transcript and OCR segments
- Product References in `product_context`
- Creative Brief product descriptions where relevant

`product_appearance_wrong` is `cannot_assess` when no usable Product Reference
or reference-derived signal is available. A URL count alone is not evidence of a
visual mismatch.

Logo reference-match signals may support product identification, but they do not
make product appearance assessable. Logo correctness remains owned by Brand
Alignment; appearance comparison requires product-scoped reference content.

### Visibility behavior

The PR #41 `insufficient_visibility` sub-check and its hard-coded three-second
and 15-percent thresholds are not part of the MVP contract.

For MVP:

- absence belongs to `product_not_shown`;
- insufficient prominence, focus, or framing belongs to `product_obscured`;
- available timestamps may support those judgments as evidence;
- independently sampled `product_frames.length / visual_frames.length` must not
  be presented as screen-time coverage.

A future deterministic visibility policy requires an explicit configuration
source and aligned temporal evidence before it becomes an additional sub-check.

## 9. Evidence construction

Evidence builders adapt `AgentContext` into model-readable content. They must:

- retain source type and timestamp;
- include stable segment or frame identifiers in the prompt where available;
- require model citations to return a supplied `source_id`, then reconstruct
  persisted evidence from the matching `AgentContext` record rather than
  trusting model-authored evidence text or timestamps;
- use current visual fields rather than removed schema fields;
- distinguish absent evidence from negative evidence;
- avoid claiming that reference-asset URLs were visually inspected when the
  evaluator received only URLs or derived match labels;
- retain the complete compact evidence set for MVP rather than blindly sampling
  by temporal position, because a short severe or decisive event may otherwise
  disappear from the Review Input;
- keep prompt construction deterministic and unit-testable.

Prompt-size optimization requires observed payload-size limits and an
agent-specific relevance policy. It must not be introduced as generic temporal
sampling that can silently discard judgment-changing evidence.

Both agents log the encoded prompt size as `prompt_bytes`. The MVP does not
impose an unmeasured cap; production telemetry determines whether a later
bounded, agent-specific evidence policy is required.

The model may select from supplied evidence, but persisted evidence must be
traceable to the supplied context. Unknown evidence types, fabricated source
identifiers, and malformed timestamps are discarded or cause the affected
finding to be unassessable.

## 10. Persistence and retry behavior

Each evaluator persists its complete result array once through
`persistMetricResults`. That module validates the results and calls
`replace_agent_metric_results`, which replaces parent metrics and child evidence
and sub-check rows atomically.

The evaluator must not:

- write result tables directly;
- perform per-row parent/child replacement calls;
- delete another agent's metrics;
- depend on invocation order across agents;
- assume that downstream aggregation has already run.

Repeated invocation for the same request must replace the evaluator-owned metric
rows deterministically.

Malformed model responses and provider-call failures produce the evaluator's
complete canonical metric set as low-confidence `cannot_assess` results. This
ensures the one-shot trigger still leaves downstream-visible rows while
preserving the ability for a later retry to atomically replace them.

## 11. Downstream handoff

This branch persists atomic judgments only. The incoming downstream trigger is
expected to:

1. wait until all required evaluator metrics are available;
2. combine `audience_fit` and `channel_readiness` into `audience_channel_fit`;
3. preserve `brief_adherence`, `brand_fit`, and `product_clarity` as independent
   scored metrics;
4. assemble the Score Engine's canonical metric set;
5. translate evaluator `cannot_assess` representation when required;
6. call the Score Engine;
7. persist the Launch-Readiness Scorecard and issues.

The broader alignment display dimension may consume `brief_adherence`,
`brand_fit`, and `audience_channel_fit`. That display roll-up must not alter or
double-count the atomic evaluator results.

## 12. Implementation strategy from PR #41

### Port with adaptation

- agent-specific prompt intent;
- injectable model-call dependencies;
- known sub-check identifiers and names;
- malformed-model-output handling;
- result and sub-check normalization tests;
- focused evidence-building tests.

### Rewrite against current `main`

- both Edge Function entrypoints;
- both `AgentContext` evidence adapters;
- metric roll-up so corrections do not create failures;
- product visibility behavior;
- any shared model-output normalization that can provide a genuinely common,
  small interface without coupling agent-specific policy.

### Do not port

- PR #41 changes under `supabase/functions/shared/`;
- row-by-row persistence;
- user-JWT invocation wiring;
- old request-scoped frame queries;
- removed visual or product-frame fields;
- root evaluation bundles and expanded seed data;
- the hard-coded `insufficient_visibility` policy.

## 13. Verification requirements

### Shared Edge Function behavior

- rejects a missing or incorrect internal trigger secret;
- rejects malformed JSON and invalid `request_id` values;
- loads context through the shared loader without a user JWT;
- persists one complete evaluator invocation atomically;
- returns only validated results;
- returns a generic error response while logging useful server-side context.

### Brief Alignment tests

- returns exactly `brief_adherence` and `audience_fit`;
- assesses each owned sub-check from current context fields;
- abstains when required brief or audience inputs are absent;
- does not grade channel format or Brand Fit;
- does not turn optional correction text into a failure;
- handles malformed or partial model output without persisting invalid results.

### Product Representation tests

- returns exactly `product_clarity`;
- evaluates presence, obscuration, appearance, and naming independently;
- treats missing reference evidence as unassessable for appearance comparison;
- distinguishes no detections from a proven product absence when evidence is
  incomplete;
- does not calculate coverage from unrelated sample counts;
- handles malformed or partial model output without persisting invalid results.

### Regression checks

- existing shared-context tests pass;
- existing Storyline, CTA, Brand, and Score Engine tests remain unchanged unless
  a separately approved contract migration requires updates;
- Deno formatting, linting, type checking, and evaluator unit tests pass.

## 14. Open decisions

- Exact severity thresholds for each Brief Alignment and Product Representation
  sub-check require evaluation calibration and should be expressed in
  agent-local configuration rather than inferred from stale documentation.
- The downstream formula for combining `audience_fit` and `channel_readiness` is
  owned by the incoming aggregation-trigger work.
- A future re-run endpoint may require the user-authenticated handler, but it is
  not part of the current internally triggered MVP flow.
