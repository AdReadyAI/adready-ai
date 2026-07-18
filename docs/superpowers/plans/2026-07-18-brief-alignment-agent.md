# Brief Alignment Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before Task 2 (and again before any task involving Deno/Supabase Edge Function conventions), invoke the **`supabase`** skill for CLI/testing conventions. For every task's red/green cycle, follow the **`superpowers:test-driven-development`** skill (write the failing test first, watch it fail, then implement).

**Goal:** Build a working `brief-alignment-agent` Supabase Edge Function that grades `audience_fit` and `brief_adherence` against an `EvidenceBundle`, returning `MetricResult[]`, using OpenRouter for the LLM call, fully unit-tested with a mocked client.

**Architecture:** `index.ts` (HTTP wiring, exports testable `handleRequest`) → `agent.ts` (OpenRouter call + guardrails, exports `runBriefAlignmentAgent`) → `evidence.ts` (validation + prompt text) and `metrics.ts` (static metric/sub-check config + forced-function-call tool schema). `shared/claude.ts` is updated once to point at OpenRouter via the OpenAI SDK.

**Tech Stack:** Deno (Supabase Edge Functions runtime), TypeScript, `npm:openai` SDK pointed at OpenRouter's OpenAI-compatible endpoint, `deno test` for unit tests (`Deno.test`, `https://deno.land/std@0.224.0/assert/mod.ts`).

## Global Constraints

- Only touch: `supabase/functions/brief-alignment-agent/**`, `supabase/functions/shared/claude.ts`, and new files under `supabase/tests/functions/unit/`. Do not modify `shared/auth.ts`, `shared/schemas.ts`, or any other agent folder.
- Input contract: `POST` body is the raw `EvidenceBundle` (no wrapper). Output: `200` with `MetricResult[]` JSON body.
- Every metric the agent owns (`audience_fit`, `brief_adherence`) is always emitted — pass, fail, or `cannot_assess` — never omitted.
- `metric_id`, `agent`, `metric_name`, `question` are filled from static config in `metrics.ts`, never taken from the model's output.
- Evidence guard: if a metric's `evidence[]` comes back empty, force its `confidence` to `"low"` regardless of what the model reported.
- Unknown `sub_checks[].check_id` values and out-of-enum `severity`/`confidence`/`result` values from the model are dropped/defaulted, never trusted as-is.
- Unit tests only — mock the OpenRouter client; no real API key, no `supabase start`, no live network calls.
- Model: `anthropic/claude-sonnet-4.5` via `OPENROUTER_API_KEY`, `temperature: 0`.

---

### Task 1: Point `shared/claude.ts` at OpenRouter

**Files:**
- Modify: `supabase/functions/shared/claude.ts`

**Interfaces:**
- Produces: `openrouter` (an `OpenAI` SDK client instance shaped `{ chat: { completions: { create(params): Promise<{ choices: [...] }> } } }`), and model ID constants `HAIKU`, `SONNET`, `OPUS` (strings).

This file is shared with `product-representation-agent`'s plan, which re-applies the identical change idempotently if this task hasn't run yet. If you're executing both plans, whichever runs first does the real work; the other's Task 1 is then a no-op verification.

- [ ] **Step 1: Read the current file and confirm it still matches the pre-change scaffold**

Run: read `supabase/functions/shared/claude.ts`. Expected current contents:

```ts
/**
 * claude.ts — Shared Anthropic client setup for all edge functions.
 */

import Anthropic from "npm:@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

// Model constants
export const HAIKU = "claude-3-haiku-20240307";
export const SONNET = "claude-3-5-sonnet-latest";
export const OPUS = "claude-3-opus-20240229";
```

If instead the file already exports `openrouter` from `npm:openai` (i.e. another task already applied this change), skip to Task 2 — this task is a no-op.

- [ ] **Step 2: Replace the file contents**

Write `supabase/functions/shared/claude.ts`:

```ts
/**
 * claude.ts — Shared OpenRouter (OpenAI-compatible) client setup for all edge functions.
 */

import OpenAI from "npm:openai";

export const openrouter = new OpenAI({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
  baseURL: "https://openrouter.ai/api/v1",
});

// Model constants (OpenRouter model IDs)
export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.5";
export const OPUS = "anthropic/claude-opus-4.5";
```

- [ ] **Step 3: Type-check the file**

Run: `deno check supabase/functions/shared/claude.ts`
Expected: no errors (network fetch of the `npm:openai` type declarations may be required — if `deno check` reports a resolution error because of no network access in your environment, note it and proceed; the import will resolve at `supabase functions serve` / deploy time).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/shared/claude.ts
git commit -m "chore: point shared OpenRouter client at OpenAI-compatible endpoint"
```

---

### Task 2: `metrics.ts` — static metric config and tool schema

**Files:**
- Create: `supabase/functions/brief-alignment-agent/metrics.ts`
- Test: `supabase/tests/functions/unit/brief_alignment_metrics_test.ts`

**Interfaces:**
- Consumes: nothing (pure static data/functions).
- Produces (used by `agent.ts` in Task 4):
  - `type BriefAlignmentMetricId = "audience_fit" | "brief_adherence"`
  - `type SubCheckId = "demographic_mismatch" | "demographic_restricted" | "objective_missed" | "required_message_missing"`
  - `type MetricConfig = { metric_id: BriefAlignmentMetricId; metric_name: string; question: string; sub_check_ids: SubCheckId[] }`
  - `const METRIC_CONFIGS: MetricConfig[]` (length 2, in order `audience_fit`, `brief_adherence`)
  - `const METRIC_IDS: BriefAlignmentMetricId[]`
  - `const ALL_SUB_CHECK_IDS: SubCheckId[]`
  - `const SUB_CHECK_NAMES: Record<SubCheckId, string>`
  - `const SEVERITY_LEVELS`, `const CONFIDENCE_LEVELS`, `const RESULT_VALUES`, `const SUB_CHECK_RESULT_VALUES`, `const CORRECTION_TYPES` (all `readonly string[]` tuples via `as const`, mirroring `shared/schemas.ts`'s enums)
  - `const TOOL_NAME = "submit_brief_alignment_findings"`
  - `function buildToolSchema(): { type: "function"; function: { name: string; description: string; parameters: object } }`

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/brief_alignment_metrics_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_SUB_CHECK_IDS,
  buildToolSchema,
  METRIC_CONFIGS,
  METRIC_IDS,
  SUB_CHECK_NAMES,
  TOOL_NAME,
} from "../../../functions/brief-alignment-agent/metrics.ts";

Deno.test("METRIC_CONFIGS covers audience_fit and brief_adherence in order", () => {
  assertEquals(METRIC_IDS, ["audience_fit", "brief_adherence"]);
  assertEquals(METRIC_CONFIGS[0].sub_check_ids, [
    "demographic_mismatch",
    "demographic_restricted",
  ]);
  assertEquals(METRIC_CONFIGS[1].sub_check_ids, [
    "objective_missed",
    "required_message_missing",
  ]);
});

Deno.test("ALL_SUB_CHECK_IDS has a name for every sub-check", () => {
  for (const id of ALL_SUB_CHECK_IDS) {
    assertEquals(typeof SUB_CHECK_NAMES[id], "string");
  }
});

Deno.test("buildToolSchema names the forced function and requires findings", () => {
  const schema = buildToolSchema();
  assertEquals(schema.function.name, TOOL_NAME);
  assertEquals(
    (schema.function.parameters as { required: string[] }).required,
    ["findings"],
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_metrics_test.ts`
Expected: FAIL — `Module not found "../../../functions/brief-alignment-agent/metrics.ts"`

- [ ] **Step 3: Implement `metrics.ts`**

Create `supabase/functions/brief-alignment-agent/metrics.ts`:

```ts
/**
 * metrics.ts — Static metric/sub-check metadata and OpenAI-style tool schema
 * for the Brief Alignment Agent. Nothing here comes from the model at
 * runtime; this is the fixed shape the agent grades against.
 */

export type BriefAlignmentMetricId = "audience_fit" | "brief_adherence";

export type SubCheckId =
  | "demographic_mismatch"
  | "demographic_restricted"
  | "objective_missed"
  | "required_message_missing";

export type MetricConfig = {
  metric_id: BriefAlignmentMetricId;
  metric_name: string;
  question: string;
  sub_check_ids: SubCheckId[];
};

export const METRIC_CONFIGS: MetricConfig[] = [
  {
    metric_id: "audience_fit",
    metric_name: "Audience Fit",
    question:
      "Does the video speak to the intended audience's needs, motivations, or context?",
    sub_check_ids: ["demographic_mismatch", "demographic_restricted"],
  },
  {
    metric_id: "brief_adherence",
    metric_name: "Brief Adherence",
    question:
      "Does the video satisfy the core campaign objective and required message from the creative brief?",
    sub_check_ids: ["objective_missed", "required_message_missing"],
  },
];

export const METRIC_IDS: BriefAlignmentMetricId[] = METRIC_CONFIGS.map(
  (m) => m.metric_id,
);

export const ALL_SUB_CHECK_IDS: SubCheckId[] = METRIC_CONFIGS.flatMap(
  (m) => m.sub_check_ids,
);

export const SUB_CHECK_NAMES: Record<SubCheckId, string> = {
  demographic_mismatch: "Demographic Profile Match",
  demographic_restricted: "Age Restriction Check",
  objective_missed: "Campaign Objective Alignment",
  required_message_missing: "Creative Brief Message Adherence",
};

export const SEVERITY_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
  "cannot_assess",
] as const;

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const RESULT_VALUES = ["true", "false", "cannot_assess"] as const;

export const SUB_CHECK_RESULT_VALUES = [
  "passed",
  "failed",
  "cannot_assess",
] as const;

export const CORRECTION_TYPES = [
  "rewrite",
  "edit_recommendation",
  "technical_fix",
  "none",
] as const;

export const EVIDENCE_TYPES = [
  "transcript",
  "ocr",
  "visual",
  "brief",
  "product_page",
  "metadata",
] as const;

export const TOOL_NAME = "submit_brief_alignment_findings";

export function buildToolSchema() {
  return {
    type: "function" as const,
    function: {
      name: TOOL_NAME,
      description:
        "Submit graded findings for every Brief Alignment metric (audience_fit, brief_adherence). Always include both, even if the result is cannot_assess.",
      parameters: {
        type: "object",
        required: ["findings"],
        properties: {
          findings: {
            type: "array",
            minItems: METRIC_CONFIGS.length,
            maxItems: METRIC_CONFIGS.length,
            items: {
              type: "object",
              required: [
                "metric_id",
                "result",
                "severity",
                "confidence",
                "evidence",
                "sub_checks",
              ],
              properties: {
                metric_id: { type: "string", enum: METRIC_IDS },
                result: { type: "string", enum: RESULT_VALUES },
                severity: { type: "string", enum: SEVERITY_LEVELS },
                confidence: { type: "string", enum: CONFIDENCE_LEVELS },
                evidence: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["type", "text", "timestamp"],
                    properties: {
                      type: { type: "string", enum: EVIDENCE_TYPES },
                      text: { type: "string" },
                      timestamp: { type: "string" },
                    },
                  },
                },
                explanation: { type: "string" },
                suggested_correction: { type: "string" },
                correction_type: { type: "string", enum: CORRECTION_TYPES },
                sub_checks: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["check_id", "result", "severity"],
                    properties: {
                      check_id: { type: "string", enum: ALL_SUB_CHECK_IDS },
                      result: {
                        type: "string",
                        enum: SUB_CHECK_RESULT_VALUES,
                      },
                      severity: { type: "string", enum: SEVERITY_LEVELS },
                      explanation: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_metrics_test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/brief-alignment-agent/metrics.ts supabase/tests/functions/unit/brief_alignment_metrics_test.ts
git commit -m "feat(brief-alignment-agent): add static metric config and tool schema"
```

---

### Task 3: `evidence.ts` — validation and prompt-context building

**Files:**
- Create: `supabase/functions/brief-alignment-agent/evidence.ts`
- Test: `supabase/tests/functions/unit/brief_alignment_evidence_test.ts`

**Interfaces:**
- Consumes: `EvidenceBundle` type from `../shared/schemas.ts` (already exists — fields used: `review_id`, `variant_id`, `creative_brief`, `campaign_goal`, `transcript_segments[]`, `ocr_segments[]`, `scene_segments[]`).
- Produces (used by `agent.ts` in Task 4 and `index.ts` in Task 5):
  - `class InvalidEvidenceBundleError extends Error`
  - `function validateEvidenceBundle(body: unknown): EvidenceBundle` — throws `InvalidEvidenceBundleError` on structural problems.
  - `function buildUserContent(bundle: EvidenceBundle): string`

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/brief_alignment_evidence_test.ts`:

```ts
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildUserContent,
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "../../../functions/brief-alignment-agent/evidence.ts";
import type { EvidenceBundle } from "../../../functions/shared/schemas.ts";

function makeBundle(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    variant_id: "variant-1",
    review_id: "review-1",
    transcript_segments: [
      {
        segment_id: "t1",
        start_ms: 0,
        end_ms: 1000,
        text: "Try Mango Moon today",
      },
    ],
    ocr_segments: [],
    keyframes: [],
    scene_segments: [
      {
        scene_id: "s1",
        start_ms: 0,
        end_ms: 1000,
        visual_description: "A person opens a can of soda.",
      },
    ],
    detected_claims: [],
    detected_ctas: [],
    product_moments: [],
    reference_assets: [],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief:
      "Show the product in the first three seconds. Use the CTA Try Mango Moon.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    ...overrides,
  };
}

Deno.test("validateEvidenceBundle accepts a well-formed bundle", () => {
  const bundle = validateEvidenceBundle(makeBundle());
  assertEquals(bundle.review_id, "review-1");
});

Deno.test("validateEvidenceBundle rejects a non-object body", () => {
  assertThrows(() => validateEvidenceBundle("nope"), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects a missing creative_brief", () => {
  const bad = makeBundle({ creative_brief: undefined });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects an invalid campaign_goal", () => {
  const bad = makeBundle({ campaign_goal: "virality" });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects a non-array transcript_segments", () => {
  const bad = makeBundle({ transcript_segments: "nope" });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("buildUserContent includes the brief, goal, transcript, and scenes", () => {
  const bundle = validateEvidenceBundle(makeBundle()) as EvidenceBundle;
  const content = buildUserContent(bundle);
  assertEquals(content.includes("Try Mango Moon"), true);
  assertEquals(content.includes("CAMPAIGN GOAL: conversion"), true);
  assertEquals(content.includes("A person opens a can of soda."), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_evidence_test.ts`
Expected: FAIL — `Module not found "../../../functions/brief-alignment-agent/evidence.ts"`

- [ ] **Step 3: Implement `evidence.ts`**

Create `supabase/functions/brief-alignment-agent/evidence.ts`:

```ts
/**
 * evidence.ts — EvidenceBundle validation and prompt-context building for
 * the Brief Alignment Agent.
 */

import type { EvidenceBundle } from "../shared/schemas.ts";

const CAMPAIGN_GOALS = [
  "awareness",
  "consideration",
  "conversion",
  "repurchase",
];

export class InvalidEvidenceBundleError extends Error {}

export function validateEvidenceBundle(body: unknown): EvidenceBundle {
  if (typeof body !== "object" || body === null) {
    throw new InvalidEvidenceBundleError("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (typeof b.review_id !== "string" || b.review_id.length === 0) {
    throw new InvalidEvidenceBundleError("review_id is required");
  }
  if (typeof b.variant_id !== "string" || b.variant_id.length === 0) {
    throw new InvalidEvidenceBundleError("variant_id is required");
  }
  if (typeof b.creative_brief !== "string") {
    throw new InvalidEvidenceBundleError("creative_brief is required");
  }
  if (
    typeof b.campaign_goal !== "string" ||
    !CAMPAIGN_GOALS.includes(b.campaign_goal)
  ) {
    throw new InvalidEvidenceBundleError(
      `campaign_goal must be one of ${CAMPAIGN_GOALS.join("|")}`,
    );
  }
  if (!Array.isArray(b.transcript_segments)) {
    throw new InvalidEvidenceBundleError(
      "transcript_segments must be an array",
    );
  }
  if (!Array.isArray(b.ocr_segments)) {
    throw new InvalidEvidenceBundleError("ocr_segments must be an array");
  }
  if (!Array.isArray(b.scene_segments)) {
    throw new InvalidEvidenceBundleError("scene_segments must be an array");
  }

  return b as unknown as EvidenceBundle;
}

export function buildUserContent(bundle: EvidenceBundle): string {
  const transcript = bundle.transcript_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const ocr = bundle.ocr_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const scenes = bundle.scene_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.visual_description}`)
    .join("\n");

  return [
    `CREATIVE BRIEF:\n${bundle.creative_brief}`,
    `CAMPAIGN GOAL: ${bundle.campaign_goal}`,
    `TRANSCRIPT:\n${transcript || "(none)"}`,
    `ON-SCREEN TEXT (OCR):\n${ocr || "(none)"}`,
    `SCENE DESCRIPTIONS:\n${scenes || "(none)"}`,
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_evidence_test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/brief-alignment-agent/evidence.ts supabase/tests/functions/unit/brief_alignment_evidence_test.ts
git commit -m "feat(brief-alignment-agent): add EvidenceBundle validation and prompt building"
```

---

### Task 4: `agent.ts` — OpenRouter call and guardrails

**Files:**
- Create: `supabase/functions/brief-alignment-agent/agent.ts`
- Test: `supabase/tests/functions/unit/brief_alignment_agent_test.ts`

**Interfaces:**
- Consumes:
  - `EvidenceBundle`, `MetricResult`, `EvidenceRef`, `SubCheckResult`, `SeverityLevel`, `ConfidenceLevel` from `../shared/schemas.ts`
  - `SONNET` from `../shared/claude.ts`
  - `ALL_SUB_CHECK_IDS`, `buildToolSchema`, `METRIC_CONFIGS`, `SEVERITY_LEVELS`, `CONFIDENCE_LEVELS`, `RESULT_VALUES`, `SUB_CHECK_RESULT_VALUES`, `CORRECTION_TYPES`, `SUB_CHECK_NAMES`, `TOOL_NAME`, `type SubCheckId` from `./metrics.ts`
  - `buildUserContent` from `./evidence.ts`
- Produces (used by `index.ts` in Task 5):
  - `type ChatClient = { chat: { completions: { create(params: Record<string, unknown>): Promise<{ choices: Array<{ message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> }> } } }`
  - `async function runBriefAlignmentAgent(bundle: EvidenceBundle, client: ChatClient): Promise<MetricResult[]>` — always returns exactly 2 results, ordered `audience_fit`, `brief_adherence`.

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/brief_alignment_agent_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ChatClient,
  runBriefAlignmentAgent,
} from "../../../functions/brief-alignment-agent/agent.ts";
import { validateEvidenceBundle } from "../../../functions/brief-alignment-agent/evidence.ts";
import type { EvidenceBundle } from "../../../functions/shared/schemas.ts";

function makeBundle(): EvidenceBundle {
  return validateEvidenceBundle({
    variant_id: "variant-1",
    review_id: "review-1",
    transcript_segments: [
      {
        segment_id: "t1",
        start_ms: 0,
        end_ms: 1000,
        text: "Try Mango Moon today",
      },
    ],
    ocr_segments: [],
    keyframes: [],
    scene_segments: [],
    detected_claims: [],
    detected_ctas: [],
    product_moments: [],
    reference_assets: [],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief:
      "Show the product in the first three seconds. Use the CTA Try Mango Moon.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
  }) as EvidenceBundle;
}

function makeMockClient(toolArguments: string): ChatClient {
  return {
    chat: {
      completions: {
        create: (_params: Record<string, unknown>) =>
          Promise.resolve({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "submit_brief_alignment_findings",
                        arguments: toolArguments,
                      },
                    },
                  ],
                },
              },
            ],
          }),
      },
    },
  };
}

Deno.test("runBriefAlignmentAgent maps a well-formed tool call to two MetricResults", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [
          { type: "transcript", text: "Try Mango Moon today", timestamp: "00:00" },
        ],
        explanation: "Tone matches the target audience.",
        sub_checks: [
          { check_id: "demographic_mismatch", result: "passed", severity: "none" },
          { check_id: "demographic_restricted", result: "passed", severity: "none" },
        ],
      },
      {
        metric_id: "brief_adherence",
        result: "false",
        severity: "medium",
        confidence: "medium",
        evidence: [
          { type: "brief", text: "Use the CTA Try Mango Moon", timestamp: "" },
        ],
        explanation: "CTA phrase is present but core message is diluted.",
        suggested_correction: "Lead with the tropical energy message before the CTA.",
        correction_type: "rewrite",
        sub_checks: [
          { check_id: "objective_missed", result: "passed", severity: "none" },
          {
            check_id: "required_message_missing",
            result: "failed",
            severity: "medium",
            explanation: "Tropical energy message never appears.",
          },
        ],
      },
    ],
  };
  const client = makeMockClient(JSON.stringify(findings));
  const results = await runBriefAlignmentAgent(makeBundle(), client);

  assertEquals(results.length, 2);
  assertEquals(results[0].metric_id, "audience_fit");
  assertEquals(results[0].agent, "brief_alignment");
  assertEquals(results[1].metric_id, "brief_adherence");
  assertEquals(results[1].result, "false");
  assertEquals(results[1].sub_checks?.[1].check_id, "required_message_missing");
});

Deno.test("runBriefAlignmentAgent drops unknown sub_check ids", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "transcript", text: "hi", timestamp: "00:00" }],
        sub_checks: [
          { check_id: "made_up_check", result: "failed", severity: "high" },
          { check_id: "demographic_mismatch", result: "passed", severity: "none" },
        ],
      },
      {
        metric_id: "brief_adherence",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [],
      },
    ],
  };
  const client = makeMockClient(JSON.stringify(findings));
  const results = await runBriefAlignmentAgent(makeBundle(), client);

  assertEquals(results[0].sub_checks?.length, 1);
  assertEquals(results[0].sub_checks?.[0].check_id, "demographic_mismatch");
});

Deno.test("runBriefAlignmentAgent forces confidence to low when evidence is empty", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "false",
        severity: "high",
        confidence: "high",
        evidence: [],
        sub_checks: [],
      },
      {
        metric_id: "brief_adherence",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [],
      },
    ],
  };
  const client = makeMockClient(JSON.stringify(findings));
  const results = await runBriefAlignmentAgent(makeBundle(), client);

  assertEquals(results[0].confidence, "low");
});

Deno.test("runBriefAlignmentAgent defaults a missing metric finding to cannot_assess", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [],
      },
    ],
  };
  const client = makeMockClient(JSON.stringify(findings));
  const results = await runBriefAlignmentAgent(makeBundle(), client);

  assertEquals(results[1].metric_id, "brief_adherence");
  assertEquals(results[1].result, "cannot_assess");
});

Deno.test("runBriefAlignmentAgent throws when the model returns no tool call", async () => {
  const client: ChatClient = {
    chat: {
      completions: {
        create: () =>
          Promise.resolve({ choices: [{ message: {} }] }),
      },
    },
  };
  let threw = false;
  try {
    await runBriefAlignmentAgent(makeBundle(), client);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_agent_test.ts`
Expected: FAIL — `Module not found "../../../functions/brief-alignment-agent/agent.ts"`

- [ ] **Step 3: Implement `agent.ts`**

Create `supabase/functions/brief-alignment-agent/agent.ts`:

```ts
/**
 * agent.ts — Orchestration for the Brief Alignment Agent: prompt assembly,
 * the OpenRouter tool-forced call, and guardrails on the returned findings.
 */

import type {
  ConfidenceLevel,
  EvidenceBundle,
  EvidenceRef,
  MetricResult,
  SeverityLevel,
  SubCheckResult,
} from "../shared/schemas.ts";
import { SONNET } from "../shared/claude.ts";
import {
  ALL_SUB_CHECK_IDS,
  buildToolSchema,
  CONFIDENCE_LEVELS,
  CORRECTION_TYPES,
  EVIDENCE_TYPES,
  type MetricConfig,
  METRIC_CONFIGS,
  RESULT_VALUES,
  SEVERITY_LEVELS,
  type SubCheckId,
  SUB_CHECK_NAMES,
  SUB_CHECK_RESULT_VALUES,
  TOOL_NAME,
} from "./metrics.ts";
import { buildUserContent } from "./evidence.ts";

export type ChatClient = {
  chat: {
    completions: {
      create: (params: Record<string, unknown>) => Promise<{
        choices: Array<{
          message: {
            tool_calls?: Array<{
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      }>;
    };
  };
};

const SYSTEM_PROMPT =
  `You are the Brief Alignment agent in an ad-review pipeline. You grade a ` +
  `video ad against its creative brief using only the transcript, on-screen ` +
  `text, and scene descriptions you are given. You never see the raw video. ` +
  `For each metric, decide status, grade severity (none, low, medium, high, ` +
  `critical), cite specific evidence (a transcript span, an OCR line, or a ` +
  `scene description), and self-report confidence (low, medium, high). If ` +
  `you cannot cite specific evidence for a finding, your confidence for it ` +
  `must be low. Use cannot_assess when the brief gives nothing to check a ` +
  `metric against. Call the ${TOOL_NAME} tool with your findings for every ` +
  `metric listed; do not respond with plain text.`;

type RawFinding = {
  metric_id?: unknown;
  result?: unknown;
  severity?: unknown;
  confidence?: unknown;
  evidence?: unknown;
  explanation?: unknown;
  suggested_correction?: unknown;
  correction_type?: unknown;
  sub_checks?: unknown;
};

function sanitizeEvidence(raw: unknown): EvidenceRef[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(EVIDENCE_TYPES);
  const out: EvidenceRef[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const rec = e as Record<string, unknown>;
    if (typeof rec.type !== "string" || !allowed.has(rec.type)) continue;
    if (typeof rec.text !== "string") continue;
    out.push({
      type: rec.type as EvidenceRef["type"],
      text: rec.text,
      timestamp: typeof rec.timestamp === "string" ? rec.timestamp : "",
    });
  }
  return out;
}

function sanitizeSubChecks(
  raw: unknown,
  allowedIds: readonly SubCheckId[],
): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(allowedIds);
  const validResults = new Set<string>(SUB_CHECK_RESULT_VALUES);
  const validSeverities = new Set<string>(SEVERITY_LEVELS);
  const out: SubCheckResult[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    if (typeof rec.check_id !== "string" || !allowed.has(rec.check_id)) {
      continue;
    }
    if (typeof rec.result !== "string" || !validResults.has(rec.result)) {
      continue;
    }
    if (
      typeof rec.severity !== "string" || !validSeverities.has(rec.severity)
    ) continue;
    out.push({
      check_id: rec.check_id,
      name: SUB_CHECK_NAMES[rec.check_id as SubCheckId] ?? rec.check_id,
      result: rec.result as SubCheckResult["result"],
      severity: rec.severity as SeverityLevel,
      explanation: typeof rec.explanation === "string"
        ? rec.explanation
        : undefined,
    });
  }
  return out;
}

function buildMetricResult(
  config: MetricConfig,
  raw: RawFinding | undefined,
): MetricResult {
  const result =
    typeof raw?.result === "string" &&
      (RESULT_VALUES as readonly string[]).includes(raw.result)
      ? (raw.result as MetricResult["result"])
      : "cannot_assess";
  const severity =
    typeof raw?.severity === "string" &&
      (SEVERITY_LEVELS as readonly string[]).includes(raw.severity)
      ? (raw.severity as SeverityLevel)
      : "cannot_assess";
  let confidence: ConfidenceLevel | undefined =
    typeof raw?.confidence === "string" &&
      (CONFIDENCE_LEVELS as readonly string[]).includes(raw.confidence)
      ? (raw.confidence as ConfidenceLevel)
      : undefined;

  const evidence = sanitizeEvidence(raw?.evidence);
  if (evidence.length === 0) {
    confidence = "low";
  }

  const subChecks = sanitizeSubChecks(raw?.sub_checks, config.sub_check_ids);

  const correctionType =
    typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
      ? (raw.correction_type as MetricResult["correction_type"])
      : "none";

  return {
    metric_id: config.metric_id,
    agent: "brief_alignment",
    metric_name: config.metric_name,
    question: config.question,
    result,
    severity,
    confidence,
    evidence,
    explanation: typeof raw?.explanation === "string"
      ? raw.explanation
      : undefined,
    suggested_correction: typeof raw?.suggested_correction === "string"
      ? raw.suggested_correction
      : undefined,
    correction_type: correctionType,
    sub_checks: subChecks,
  };
}

export async function runBriefAlignmentAgent(
  bundle: EvidenceBundle,
  client: ChatClient,
): Promise<MetricResult[]> {
  const response = await client.chat.completions.create({
    model: SONNET,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserContent(bundle) },
    ],
    tools: [buildToolSchema()],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  });

  const toolCall = response.choices[0]?.message.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== TOOL_NAME) {
    throw new Error("model did not return the expected tool call");
  }

  let parsed: { findings?: unknown };
  try {
    parsed = JSON.parse(toolCall.function.arguments) as { findings?: unknown };
  } catch {
    throw new Error("model returned invalid JSON in tool call arguments");
  }

  const findings = Array.isArray(parsed.findings)
    ? (parsed.findings as RawFinding[])
    : [];
  const byMetricId = new Map<string, RawFinding>();
  for (const f of findings) {
    if (typeof f.metric_id === "string") byMetricId.set(f.metric_id, f);
  }

  return METRIC_CONFIGS.map((config) =>
    buildMetricResult(config, byMetricId.get(config.metric_id))
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_agent_test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/brief-alignment-agent/agent.ts supabase/tests/functions/unit/brief_alignment_agent_test.ts
git commit -m "feat(brief-alignment-agent): add OpenRouter orchestration with output guardrails"
```

---

### Task 5: `index.ts` — HTTP handler wiring

**Files:**
- Modify: `supabase/functions/brief-alignment-agent/index.ts` (replace the doc-comment-only scaffold)
- Test: `supabase/tests/functions/unit/brief_alignment_index_test.ts`

**Interfaces:**
- Consumes: `verifyAuth` from `../shared/auth.ts` (existing, currently always returns `null`); `openrouter` from `../shared/claude.ts` (Task 1); `EvidenceBundle` from `../shared/schemas.ts`; `validateEvidenceBundle`, `InvalidEvidenceBundleError` from `./evidence.ts` (Task 3); `runBriefAlignmentAgent`, `type ChatClient` from `./agent.ts` (Task 4).
- Produces: `async function handleRequest(req: Request, deps?: { client: ChatClient }): Promise<Response>` — the exported, directly-testable HTTP handler. `Deno.serve` wraps it with the real `openrouter` client as the default.

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/brief_alignment_index_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "../../../functions/brief-alignment-agent/index.ts";
import type { ChatClient } from "../../../functions/brief-alignment-agent/agent.ts";

function makeMockClient(toolArguments: string): ChatClient {
  return {
    chat: {
      completions: {
        create: (_params: Record<string, unknown>) =>
          Promise.resolve({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "submit_brief_alignment_findings",
                        arguments: toolArguments,
                      },
                    },
                  ],
                },
              },
            ],
          }),
      },
    },
  };
}

function makeValidBundleBody(): Record<string, unknown> {
  return {
    variant_id: "variant-1",
    review_id: "review-1",
    transcript_segments: [],
    ocr_segments: [],
    keyframes: [],
    scene_segments: [],
    detected_claims: [],
    detected_ctas: [],
    product_moments: [],
    reference_assets: [],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief: "Show the product early.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
  };
}

Deno.test("handleRequest returns 400 on invalid JSON body", async () => {
  const req = new Request("http://localhost/brief-alignment-agent", {
    method: "POST",
    body: "not json",
  });
  const res = await handleRequest(req, { client: makeMockClient("{}") });
  assertEquals(res.status, 400);
});

Deno.test("handleRequest returns 400 on a structurally invalid EvidenceBundle", async () => {
  const req = new Request("http://localhost/brief-alignment-agent", {
    method: "POST",
    body: JSON.stringify({ foo: "bar" }),
  });
  const res = await handleRequest(req, { client: makeMockClient("{}") });
  assertEquals(res.status, 400);
});

Deno.test("handleRequest returns 405 on non-POST", async () => {
  const req = new Request("http://localhost/brief-alignment-agent", {
    method: "GET",
  });
  const res = await handleRequest(req, { client: makeMockClient("{}") });
  assertEquals(res.status, 405);
});

Deno.test("handleRequest returns 200 with MetricResult[] on success", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [],
      },
      {
        metric_id: "brief_adherence",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [],
      },
    ],
  };
  const req = new Request("http://localhost/brief-alignment-agent", {
    method: "POST",
    body: JSON.stringify(makeValidBundleBody()),
  });
  const res = await handleRequest(req, {
    client: makeMockClient(JSON.stringify(findings)),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(Array.isArray(body), true);
  assertEquals(body.length, 2);
});

Deno.test("handleRequest returns 500 when the model returns no tool call", async () => {
  const badClient: ChatClient = {
    chat: {
      completions: {
        create: () => Promise.resolve({ choices: [{ message: {} }] }),
      },
    },
  };
  const req = new Request("http://localhost/brief-alignment-agent", {
    method: "POST",
    body: JSON.stringify(makeValidBundleBody()),
  });
  const res = await handleRequest(req, { client: badClient });
  assertEquals(res.status, 500);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_index_test.ts`
Expected: FAIL — current `index.ts` has no exported `handleRequest` (everything is commented out).

- [ ] **Step 3: Implement `index.ts`**

Replace `supabase/functions/brief-alignment-agent/index.ts` (keep the existing top doc comment block describing the metrics/sub-checks as-is above the code; append the implementation below it):

```ts
import { verifyAuth } from "../shared/auth.ts";
import { openrouter } from "../shared/claude.ts";
import type { EvidenceBundle } from "../shared/schemas.ts";
import {
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "./evidence.ts";
import { type ChatClient, runBriefAlignmentAgent } from "./agent.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRequest(
  req: Request,
  deps: { client: ChatClient } = { client: openrouter },
): Promise<Response> {
  const authError = await verifyAuth(req);
  if (authError) return authError;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  let bundle: EvidenceBundle;
  try {
    bundle = validateEvidenceBundle(body);
  } catch (err) {
    if (err instanceof InvalidEvidenceBundleError) {
      return jsonResponse({ error: err.message }, 400);
    }
    throw err;
  }

  try {
    const results = await runBriefAlignmentAgent(bundle, deps.client);
    return jsonResponse(results, 200);
  } catch (err) {
    console.error("brief-alignment-agent failed", err);
    return jsonResponse({ error: "internal error" }, 500);
  }
}

Deno.serve((req) => handleRequest(req));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_index_test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full unit test suite for this agent**

Run: `cd supabase && deno test tests/functions/unit/brief_alignment_metrics_test.ts tests/functions/unit/brief_alignment_evidence_test.ts tests/functions/unit/brief_alignment_agent_test.ts tests/functions/unit/brief_alignment_index_test.ts`
Expected: PASS (19 tests total)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/brief-alignment-agent/index.ts supabase/tests/functions/unit/brief_alignment_index_test.ts
git commit -m "feat(brief-alignment-agent): implement Deno.serve HTTP handler"
```

---

## After this plan

The function type-checks and its unit tests pass with a mocked client, but no real OpenRouter call has been made. To confirm live output quality, you (the user) would need to run `supabase start`, set `OPENROUTER_API_KEY`, run `supabase functions serve brief-alignment-agent`, and POST a real `EvidenceBundle` — that step is intentionally not automated here.
