# Design: Brief Alignment & Product Representation Edge Function Agents

## Context

`supabase/functions/brief-alignment-agent` and `supabase/functions/product-representation-agent`
are currently doc-comment-only scaffolds (all code commented out). The confirmed I/O contract for
every agent lives in `supabase/functions/shared/schemas.ts`: input is an `EvidenceBundle`, output is
`MetricResult[]`. The source PDF outline (GroundingBundle / Standard Finding Object / 0-4 numeric
severity / grounded-vs-judgment confidence) describes a different, not-yet-built contract and is used
here only as inspiration for sub-checks, not as the binding interface.

Scope is strictly limited to:
- `supabase/functions/brief-alignment-agent/`
- `supabase/functions/product-representation-agent/`
- `supabase/functions/shared/claude.ts` (one small, targeted change — see below)
- new test files under `supabase/tests/functions/unit/` (existing repo convention)

No other files are touched.

## Provider change: OpenRouter, not direct Anthropic

`shared/claude.ts` currently wraps `npm:@anthropic-ai/sdk` pointed directly at Anthropic's API. The
project actually uses OpenRouter. OpenRouter's primary interface is OpenAI-compatible chat
completions (function calling), not Anthropic's native Messages/tool-use format, so:

```ts
// supabase/functions/shared/claude.ts
import OpenAI from "npm:openai";

export const openrouter = new OpenAI({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
  baseURL: "https://openrouter.ai/api/v1",
});

export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.5";
export const OPUS = "anthropic/claude-opus-4.5";
```

Both agents accept an injected client shaped like `{ chat: { completions: { create(...) } } }` (the
OpenAI SDK shape) so unit tests can mock it without a real network call or touching this file further.
The other five agent scaffolds only reference the old export via commented-out imports, so renaming
`anthropic` → `openrouter` breaks nothing live.

## Request/response contract (both agents)

- `POST` body = the raw `EvidenceBundle` JSON, no wrapper.
- `verifyAuth(req)` is called first (currently a pass-through stub; wiring it in now costs nothing and
  matches the `claims-agent` scaffold's pattern).
- 400 on invalid JSON or a structurally invalid `EvidenceBundle` (defensive runtime checks, not just
  trusting the TS type).
- 200 with `MetricResult[]` — one result per metric the agent owns, always emitted (pass, fail, *and*
  `cannot_assess`), not fail-only. This is simpler than the PDF's fail-only emission (written for a
  different contract) and gives the scoring engine an explicit status for every metric every time.
- 500 + generic message on unexpected/provider errors; details go to `console.error` only.

`index.ts` exports `handleRequest(req, deps)` (`deps.client` is the injectable OpenRouter-shaped
client) and wires `Deno.serve` around it, so the whole HTTP handler is testable without a live network
call or `supabase functions serve`.

## File layout (both folders)

```
<agent-folder>/
  index.ts     — Deno.serve wiring; exports handleRequest(req, deps)
  metrics.ts   — static per-metric config: metric_id, metric_name, question, sub-check ids/rubric text,
                 tool/function schema builder
  evidence.ts  — pure EvidenceBundle validation + prompt-context building
  agent.ts     — runXAgent(bundle, client): builds messages, calls client.chat.completions.create with
                 tool_choice forced, parses the function-call arguments, merges static metadata,
                 applies guardrails, returns MetricResult[]
```

## Structured output via forced function calling

One OpenAI-style `tools: [{ type: "function", function: {...} }]` definition per agent call, with
`tool_choice` forced to that function so the model can only respond via the structured call, never
prose. The function's JSON Schema only asks the model for what it should actually decide: `result`,
`severity`, `confidence`, `evidence[]`, `explanation`, `suggested_correction`, `correction_type`, and
`sub_checks[]` (each `check_id` constrained by `enum` to that metric's known sub-check ids).

`metric_id`, `agent`, `metric_name`, and `question` are **never** taken from the model — they're
filled in afterward from the static config in `metrics.ts`, keyed by the fixed metric list each agent
owns. This keeps static labels from drifting or being hallucinated.

## Post-processing guardrails (pure functions, unit-testable, no network)

- Clamp/reject any `severity` or `confidence` value outside the schema's enums.
- Drop any `sub_checks[].check_id` not in the known set for that metric.
- **Evidence guard:** if a metric's `evidence[]` is empty, force `confidence` to `"low"` regardless of
  what the model reported.

## Brief Alignment Agent

Owns two metrics (matches `MetricId` + the existing doc scaffold):

- `audience_fit` — sub-checks `demographic_mismatch`, `demographic_restricted`
- `brief_adherence` — sub-checks `objective_missed`, `required_message_missing`

Single OpenRouter call per invocation, tool schema returns both metric objects at once (batched per
agent, matching the PDF's latency guidance and the existing scaffold's example output showing both
metrics from one call). Reasoning inputs: `creative_brief` (free text — no separate cached
requirement-extraction step; that PDF idea assumed brief reuse across many videos, which is out of
scope here), `campaign_goal`, `transcript_segments`, `ocr_segments`, `scene_segments`.

## Product Representation Agent

Owns one metric: `product_clarity`, with four sub-checks:

- `product_not_shown`, `product_obscured`, `product_name_unspoken` — LLM-graded from a
  text description built by joining `product_moments` → `frame_ids` → `keyframes.scene_id` →
  matching `scene_segments.visual_description` / `visual_elements`. **No real vision** — `Keyframe`
  has no description field and only an `image_url`, so keyframes are described via their linked scene
  text. A comment marks this as the place to plug in real vision or an explicit keyframe-description
  field once Media Processing confirms what they'll actually supply.
- `product_appearance_wrong` — kept per your instruction, but weakened to a text-only signal: the
  model may only compare OCR text against the brief's stated product/packaging description, and must
  return `cannot_assess` when no relevant OCR text exists. Commented as needing vision or a reference
  packaging-text field before it's trustworthy.
- `insufficient_visibility` — **not** LLM-graded. Computed deterministically in code from
  `product_moments` (first-appearance timing, % of runtime covered) vs. `video_metadata.duration_ms`,
  against hardcoded default thresholds flagged as TODO-configurable once Evaluation Science publishes
  real CPG numbers. Merged into `product_clarity.sub_checks[]` alongside the LLM-graded ones. This
  needs no client/mock to test at all.

## Testing plan

- Unit tests only, under `supabase/tests/functions/unit/`, following the existing
  `edge_function_template_test.ts` convention: `brief_alignment_agent_test.ts`,
  `product_representation_agent_test.ts`.
- Mock the OpenRouter client (`{ chat: { completions: { create: () => canned response } } }`) — no
  real API key, no network, no `supabase start` required.
- Coverage: EvidenceBundle validation (missing/malformed fields), the scene-join logic for
  product-representation, the deterministic `insufficient_visibility` math on its own (no mock needed),
  guardrail post-processing (enum clamping, unknown check_id dropping, evidence-guard confidence
  downgrade), and `handleRequest` end-to-end with a mocked client for the 200/400/500 status paths.
- A real end-to-end call (live `OPENROUTER_API_KEY` + `supabase functions serve`) is **not** run by me;
  flagged as something you'd run manually to sanity-check live output quality.

## Open TODOs / notes for future work

- `product_appearance_wrong` and the scene-description-based sub-checks should be revisited once
  Media Processing confirms whether keyframes get real descriptions or images become directly usable
  (vision).
- `insufficient_visibility` thresholds are placeholder defaults pending Evaluation Science's CPG
  numbers.
- Brief Alignment's requirement-extraction-as-a-separate-cached-step (from the PDF) is out of scope;
  each call reasons over the full brief text directly.
