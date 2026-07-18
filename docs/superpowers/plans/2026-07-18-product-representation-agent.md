# Product Representation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before Task 2 (and again before any task involving Deno/Supabase Edge Function conventions), invoke the **`supabase`** skill for CLI/testing conventions. For every task's red/green cycle, follow the **`superpowers:test-driven-development`** skill (write the failing test first, watch it fail, then implement).

**Goal:** Build a working `product-representation-agent` Supabase Edge Function that grades `product_clarity` against an `EvidenceBundle`, returning `MetricResult[]`, using OpenRouter for the LLM-graded sub-checks plus a deterministic (non-LLM) screen-time coverage check, fully unit-tested with a mocked client.

**Architecture:** `index.ts` (HTTP wiring, exports testable `handleRequest`) → `agent.ts` (OpenRouter call + deterministic timing check + guardrails, exports `runProductRepresentationAgent`) → `evidence.ts` (validation, keyframe→scene join, prompt text) and `metrics.ts` (static metric/sub-check config + forced-function-call tool schema). `shared/claude.ts` is updated once to point at OpenRouter via the OpenAI SDK (shared with the brief-alignment-agent plan — idempotent here).

**Tech Stack:** Deno (Supabase Edge Functions runtime), TypeScript, `npm:openai` SDK pointed at OpenRouter's OpenAI-compatible endpoint, `deno test` for unit tests (`Deno.test`, `https://deno.land/std@0.224.0/assert/mod.ts`).

## Global Constraints

- Only touch: `supabase/functions/product-representation-agent/**`, `supabase/functions/shared/claude.ts`, and new files under `supabase/tests/functions/unit/`. Do not modify `shared/auth.ts`, `shared/schemas.ts`, or any other agent folder.
- Input contract: `POST` body is the raw `EvidenceBundle` (no wrapper). Output: `200` with `MetricResult[]` JSON body (always exactly 1 result: `product_clarity`).
- **No vision.** `Keyframe` only has `frame_id`/`timestamp_ms`/`scene_id`/`image_url` — no description field, and we don't fetch/view `image_url`. Product moments are described to the model via the `scene_segments.visual_description`/`visual_elements` linked through each keyframe's `scene_id`. This is a known limitation — see "Open notes" at the end of this plan.
- `metric_id`, `agent`, `metric_name`, `question` are filled from static config in `metrics.ts`, never taken from the model's output.
- Evidence guard: if the metric's `evidence[]` comes back empty, force `confidence` to `"low"` regardless of what the model reported.
- Unknown `sub_checks[].check_id` values and out-of-enum `severity`/`confidence`/`result` values from the model are dropped/defaulted, never trusted as-is.
- `insufficient_visibility` is computed **deterministically in code** (first-appearance timing + % runtime coverage from `product_moments` vs. `video_metadata.duration_ms`), not by the LLM, and is merged into `product_clarity.sub_checks[]` alongside the three LLM-graded sub-checks. If it fails worse than the LLM's top-level severity, it overrides the metric's top-level `result`/`severity`.
- `product_appearance_wrong` is a weak, text-only signal (OCR-vs-brief comparison only) per explicit product decision — not a true visual comparison. Comment this limitation in the prompt/system message.
- Unit tests only — mock the OpenRouter client; no real API key, no `supabase start`, no live network calls.
- Model: `anthropic/claude-sonnet-4.5` via `OPENROUTER_API_KEY`, `temperature: 0`.

---

### Task 1: Point `shared/claude.ts` at OpenRouter

**Files:**
- Modify: `supabase/functions/shared/claude.ts`

**Interfaces:**
- Produces: `openrouter` (an `OpenAI` SDK client instance shaped `{ chat: { completions: { create(params): Promise<{ choices: [...] }> } } }`), and model ID constants `HAIKU`, `SONNET`, `OPUS` (strings).

This is the identical change described in the brief-alignment-agent plan's Task 1. It's idempotent: if that plan already ran, this task is a no-op verification.

- [ ] **Step 1: Read the current file and check whether it's already updated**

Run: read `supabase/functions/shared/claude.ts`.

If it already contains `export const openrouter` from `npm:openai`, this task is done — skip to Task 2.

If it still matches the pre-change scaffold below, proceed to Step 2:

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
Expected: no errors (if `deno check` reports a resolution error for `npm:openai` type declarations because your environment has no network access, note it and proceed — it resolves at `supabase functions serve` / deploy time).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/shared/claude.ts
git commit -m "chore: point shared OpenRouter client at OpenAI-compatible endpoint"
```

(If this was a no-op because another task already applied it, skip committing — there's nothing to commit.)

---

### Task 2: `metrics.ts` — static metric config and tool schema

**Files:**
- Create: `supabase/functions/product-representation-agent/metrics.ts`
- Test: `supabase/tests/functions/unit/product_representation_metrics_test.ts`

**Interfaces:**
- Consumes: nothing (pure static data/functions).
- Produces (used by `agent.ts` in Task 4):
  - `type LlmSubCheckId = "product_not_shown" | "product_obscured" | "product_appearance_wrong" | "product_name_unspoken"`
  - `type DeterministicSubCheckId = "insufficient_visibility"`
  - `type SubCheckId = LlmSubCheckId | DeterministicSubCheckId`
  - `const LLM_SUB_CHECK_IDS: LlmSubCheckId[]`
  - `const SUB_CHECK_NAMES: Record<SubCheckId, string>` (includes `insufficient_visibility`)
  - `const METRIC_ID = "product_clarity"`, `const METRIC_NAME = "Product Clarity"`, `const METRIC_QUESTION: string`
  - `const SEVERITY_LEVELS`, `const CONFIDENCE_LEVELS`, `const RESULT_VALUES`, `const SUB_CHECK_RESULT_VALUES`, `const CORRECTION_TYPES`, `const EVIDENCE_TYPES` (all `readonly string[]` tuples via `as const`)
  - `const TOOL_NAME = "submit_product_representation_findings"`
  - `function buildToolSchema(): { type: "function"; function: { name: string; description: string; parameters: object } }` — parameters cover only the metric's top-level fields plus `sub_checks` constrained to `LLM_SUB_CHECK_IDS` (never `insufficient_visibility`, which the model must not attempt to grade).

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/product_representation_metrics_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildToolSchema,
  LLM_SUB_CHECK_IDS,
  METRIC_ID,
  SUB_CHECK_NAMES,
  TOOL_NAME,
} from "../../../functions/product-representation-agent/metrics.ts";

Deno.test("METRIC_ID is product_clarity", () => {
  assertEquals(METRIC_ID, "product_clarity");
});

Deno.test("LLM_SUB_CHECK_IDS has four entries and excludes insufficient_visibility", () => {
  assertEquals(LLM_SUB_CHECK_IDS.length, 4);
  assertEquals(LLM_SUB_CHECK_IDS.includes("insufficient_visibility" as never), false);
});

Deno.test("SUB_CHECK_NAMES covers both LLM and deterministic sub-checks", () => {
  assertEquals(typeof SUB_CHECK_NAMES.insufficient_visibility, "string");
  for (const id of LLM_SUB_CHECK_IDS) {
    assertEquals(typeof SUB_CHECK_NAMES[id], "string");
  }
});

Deno.test("buildToolSchema names the forced function and excludes insufficient_visibility from sub_checks enum", () => {
  const schema = buildToolSchema();
  assertEquals(schema.function.name, TOOL_NAME);
  const params = schema.function.parameters as {
    properties: {
      sub_checks: { items: { properties: { check_id: { enum: string[] } } } };
    };
  };
  const allowedCheckIds = params.properties.sub_checks.items.properties.check_id.enum;
  assertEquals(allowedCheckIds.includes("insufficient_visibility"), false);
  assertEquals(allowedCheckIds.length, 4);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/product_representation_metrics_test.ts`
Expected: FAIL — `Module not found "../../../functions/product-representation-agent/metrics.ts"`

- [ ] **Step 3: Implement `metrics.ts`**

Create `supabase/functions/product-representation-agent/metrics.ts`:

```ts
/**
 * metrics.ts — Static metric/sub-check metadata and OpenAI-style tool schema
 * for the Product Representation Agent. Nothing here comes from the model
 * at runtime; this is the fixed shape the agent grades against.
 *
 * insufficient_visibility is intentionally excluded from the tool schema:
 * it's computed deterministically in agent.ts from product_moments timing,
 * not graded by the model.
 */

export type LlmSubCheckId =
  | "product_not_shown"
  | "product_obscured"
  | "product_appearance_wrong"
  | "product_name_unspoken";

export type DeterministicSubCheckId = "insufficient_visibility";

export type SubCheckId = LlmSubCheckId | DeterministicSubCheckId;

export const LLM_SUB_CHECK_IDS: LlmSubCheckId[] = [
  "product_not_shown",
  "product_obscured",
  "product_appearance_wrong",
  "product_name_unspoken",
];

export const SUB_CHECK_NAMES: Record<SubCheckId, string> = {
  product_not_shown: "Product Presence Check",
  product_obscured: "Product Visibility Check",
  product_appearance_wrong: "Product Appearance",
  product_name_unspoken: "Brand Name Mention Check",
  insufficient_visibility: "Product Screen-Time Coverage",
};

export const METRIC_ID = "product_clarity" as const;
export const METRIC_NAME = "Product Clarity";
export const METRIC_QUESTION =
  "Can a viewer clearly identify what product is being advertised?";

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

export const TOOL_NAME = "submit_product_representation_findings";

export function buildToolSchema() {
  return {
    type: "function" as const,
    function: {
      name: TOOL_NAME,
      description:
        "Submit the graded product_clarity finding for this ad, covering " +
        "product_not_shown, product_obscured, product_appearance_wrong, " +
        "and product_name_unspoken. Do not include insufficient_visibility " +
        "— that sub-check is computed separately from timing data.",
      parameters: {
        type: "object",
        required: ["result", "severity", "confidence", "evidence", "sub_checks"],
        properties: {
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
                check_id: { type: "string", enum: LLM_SUB_CHECK_IDS },
                result: { type: "string", enum: SUB_CHECK_RESULT_VALUES },
                severity: { type: "string", enum: SEVERITY_LEVELS },
                explanation: { type: "string" },
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

Run: `cd supabase && deno test tests/functions/unit/product_representation_metrics_test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/product-representation-agent/metrics.ts supabase/tests/functions/unit/product_representation_metrics_test.ts
git commit -m "feat(product-representation-agent): add static metric config and tool schema"
```

---

### Task 3: `evidence.ts` — validation, keyframe→scene join, prompt building

**Files:**
- Create: `supabase/functions/product-representation-agent/evidence.ts`
- Test: `supabase/tests/functions/unit/product_representation_evidence_test.ts`

**Interfaces:**
- Consumes: `EvidenceBundle` type from `../shared/schemas.ts` (fields used: `review_id`, `variant_id`, `creative_brief`, `product_moments[]`, `keyframes[]`, `scene_segments[]`, `reference_assets[]`, `transcript_segments[]`, `ocr_segments[]`, `video_metadata.duration_ms`).
- Produces (used by `agent.ts` in Task 4 and `index.ts` in Task 5):
  - `class InvalidEvidenceBundleError extends Error`
  - `function validateEvidenceBundle(body: unknown): EvidenceBundle`
  - `type ProductMomentContext = { moment_id: string; start_ms: number; end_ms: number; frame_ids: string[]; scene_descriptions: string[] }`
  - `function buildProductMomentContexts(bundle: EvidenceBundle): ProductMomentContext[]`
  - `function buildUserContent(bundle: EvidenceBundle): string`

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/product_representation_evidence_test.ts`:

```ts
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildProductMomentContexts,
  buildUserContent,
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "../../../functions/product-representation-agent/evidence.ts";
import type { EvidenceBundle } from "../../../functions/shared/schemas.ts";

function makeBundleBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    variant_id: "variant-1",
    review_id: "review-1",
    transcript_segments: [
      { segment_id: "t1", start_ms: 0, end_ms: 1000, text: "Try Mango Moon" },
    ],
    ocr_segments: [],
    keyframes: [
      { frame_id: "f1", timestamp_ms: 500, scene_id: "s1", image_url: "https://cdn/f1.png" },
      { frame_id: "f2", timestamp_ms: 2500, scene_id: "s2", image_url: "https://cdn/f2.png" },
    ],
    scene_segments: [
      {
        scene_id: "s1",
        start_ms: 0,
        end_ms: 1000,
        visual_description: "A can of Mango Moon soda sits on a counter.",
      },
      {
        scene_id: "s2",
        start_ms: 2000,
        end_ms: 3000,
        visual_description: "Close-up of a hand holding the can.",
        visual_elements: { dominant_colors: ["#FFA500"], tone_mood: "bright" },
      },
    ],
    detected_claims: [],
    detected_ctas: [],
    product_moments: [
      { moment_id: "m1", start_ms: 500, end_ms: 2600, frame_ids: ["f1", "f2"] },
    ],
    reference_assets: [
      { asset_id: "ra1", type: "product_image", image_url: "https://cdn/ref.png" },
    ],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief: "Show the Mango Moon can clearly within the first 3 seconds.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    ...overrides,
  };
}

Deno.test("validateEvidenceBundle accepts a well-formed bundle", () => {
  const bundle = validateEvidenceBundle(makeBundleBody());
  assertEquals(bundle.review_id, "review-1");
});

Deno.test("validateEvidenceBundle rejects a missing video_metadata.duration_ms", () => {
  const bad = makeBundleBody({ video_metadata: { aspect_ratio: "9:16" } });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("validateEvidenceBundle rejects a non-array product_moments", () => {
  const bad = makeBundleBody({ product_moments: "nope" });
  assertThrows(() => validateEvidenceBundle(bad), InvalidEvidenceBundleError);
});

Deno.test("buildProductMomentContexts joins keyframes to their scene descriptions", () => {
  const bundle = validateEvidenceBundle(makeBundleBody()) as EvidenceBundle;
  const contexts = buildProductMomentContexts(bundle);

  assertEquals(contexts.length, 1);
  assertEquals(contexts[0].moment_id, "m1");
  assertEquals(
    contexts[0].scene_descriptions.some((d) =>
      d.includes("A can of Mango Moon soda sits on a counter.")
    ),
    true,
  );
  assertEquals(
    contexts[0].scene_descriptions.some((d) => d.includes("bright")),
    true,
  );
});

Deno.test("buildProductMomentContexts handles a moment with no matching keyframes", () => {
  const bundle = validateEvidenceBundle(
    makeBundleBody({
      product_moments: [
        { moment_id: "m2", start_ms: 5000, end_ms: 6000, frame_ids: ["missing"] },
      ],
    }),
  ) as EvidenceBundle;
  const contexts = buildProductMomentContexts(bundle);

  assertEquals(contexts[0].scene_descriptions, []);
});

Deno.test("buildUserContent includes the brief, moment descriptions, and duration", () => {
  const bundle = validateEvidenceBundle(makeBundleBody()) as EvidenceBundle;
  const content = buildUserContent(bundle);
  assertEquals(content.includes("Mango Moon can clearly"), true);
  assertEquals(content.includes("A can of Mango Moon soda sits on a counter."), true);
  assertEquals(content.includes("TOTAL VIDEO DURATION: 15000ms"), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/product_representation_evidence_test.ts`
Expected: FAIL — `Module not found "../../../functions/product-representation-agent/evidence.ts"`

- [ ] **Step 3: Implement `evidence.ts`**

Create `supabase/functions/product-representation-agent/evidence.ts`:

```ts
/**
 * evidence.ts — EvidenceBundle validation, keyframe→scene join, and
 * prompt-context building for the Product Representation Agent.
 *
 * No vision: Keyframe only carries frame_id/timestamp_ms/scene_id/image_url,
 * so each product moment's keyframes are described to the model via the
 * linked scene_segments.visual_description / visual_elements rather than
 * the actual image. Revisit this once Media Processing confirms whether
 * keyframes will carry real descriptions or images become viewable.
 */

import type { EvidenceBundle } from "../shared/schemas.ts";

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
  if (!Array.isArray(b.product_moments)) {
    throw new InvalidEvidenceBundleError("product_moments must be an array");
  }
  if (!Array.isArray(b.keyframes)) {
    throw new InvalidEvidenceBundleError("keyframes must be an array");
  }
  if (!Array.isArray(b.scene_segments)) {
    throw new InvalidEvidenceBundleError("scene_segments must be an array");
  }
  if (!Array.isArray(b.reference_assets)) {
    throw new InvalidEvidenceBundleError("reference_assets must be an array");
  }
  if (!Array.isArray(b.transcript_segments)) {
    throw new InvalidEvidenceBundleError(
      "transcript_segments must be an array",
    );
  }
  if (!Array.isArray(b.ocr_segments)) {
    throw new InvalidEvidenceBundleError("ocr_segments must be an array");
  }
  const videoMetadata = b.video_metadata as Record<string, unknown> | undefined;
  if (!videoMetadata || typeof videoMetadata.duration_ms !== "number") {
    throw new InvalidEvidenceBundleError(
      "video_metadata.duration_ms is required",
    );
  }

  return b as unknown as EvidenceBundle;
}

export type ProductMomentContext = {
  moment_id: string;
  start_ms: number;
  end_ms: number;
  frame_ids: string[];
  scene_descriptions: string[];
};

export function buildProductMomentContexts(
  bundle: EvidenceBundle,
): ProductMomentContext[] {
  const keyframeById = new Map(bundle.keyframes.map((k) => [k.frame_id, k]));
  const sceneById = new Map(bundle.scene_segments.map((s) => [s.scene_id, s]));

  return bundle.product_moments.map((moment) => {
    const descriptions: string[] = [];
    for (const frameId of moment.frame_ids) {
      const keyframe = keyframeById.get(frameId);
      if (!keyframe) continue;
      const scene = sceneById.get(keyframe.scene_id);
      if (!scene) continue;

      const elements = scene.visual_elements;
      const extras = elements
        ? [
          elements.detected_people?.length
            ? `people: ${elements.detected_people.join(", ")}`
            : "",
          elements.dominant_colors?.length
            ? `colors: ${elements.dominant_colors.join(", ")}`
            : "",
          elements.tone_mood ? `mood: ${elements.tone_mood}` : "",
        ].filter(Boolean).join("; ")
        : "";

      descriptions.push(
        extras
          ? `${scene.visual_description} (${extras})`
          : scene.visual_description,
      );
    }

    return {
      moment_id: moment.moment_id,
      start_ms: moment.start_ms,
      end_ms: moment.end_ms,
      frame_ids: moment.frame_ids,
      scene_descriptions: [...new Set(descriptions)],
    };
  });
}

export function buildUserContent(bundle: EvidenceBundle): string {
  const moments = buildProductMomentContexts(bundle);
  const momentsText = moments
    .map((m) =>
      `[moment ${m.moment_id}, ${m.start_ms}-${m.end_ms}ms] ${
        m.scene_descriptions.length
          ? m.scene_descriptions.join(" | ")
          : "(no scene description available for this moment's keyframes)"
      }`
    )
    .join("\n");
  const transcript = bundle.transcript_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const ocr = bundle.ocr_segments
    .map((s) => `[${s.start_ms}-${s.end_ms}ms] ${s.text}`)
    .join("\n");
  const referenceAssets = bundle.reference_assets
    .filter((a) => a.type === "product_image")
    .map((a) => `product_image reference: ${a.asset_id}`)
    .join("\n");

  return [
    `CREATIVE BRIEF (contains the product name/packaging description):\n${bundle.creative_brief}`,
    `PRODUCT MOMENTS (time ranges the product is detected on screen, described via linked scene text — no direct image access):\n${
      momentsText || "(no product moments detected)"
    }`,
    `TRANSCRIPT:\n${transcript || "(none)"}`,
    `ON-SCREEN TEXT (OCR):\n${ocr || "(none)"}`,
    `REFERENCE ASSETS AVAILABLE (image URLs only, not viewable by you):\n${
      referenceAssets || "(none)"
    }`,
    `TOTAL VIDEO DURATION: ${bundle.video_metadata.duration_ms}ms`,
  ].join("\n\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/product_representation_evidence_test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/product-representation-agent/evidence.ts supabase/tests/functions/unit/product_representation_evidence_test.ts
git commit -m "feat(product-representation-agent): add EvidenceBundle validation, scene join, and prompt building"
```

---

### Task 4: `agent.ts` — deterministic visibility check, OpenRouter call, and guardrails

**Files:**
- Create: `supabase/functions/product-representation-agent/agent.ts`
- Test: `supabase/tests/functions/unit/product_representation_agent_test.ts`

**Interfaces:**
- Consumes:
  - `ConfidenceLevel`, `EvidenceBundle`, `EvidenceRef`, `MetricResult`, `SeverityLevel`, `SubCheckResult` from `../shared/schemas.ts`
  - `SONNET` from `../shared/claude.ts`
  - `buildToolSchema`, `CONFIDENCE_LEVELS`, `CORRECTION_TYPES`, `EVIDENCE_TYPES`, `LLM_SUB_CHECK_IDS`, `METRIC_ID`, `METRIC_NAME`, `METRIC_QUESTION`, `RESULT_VALUES`, `SEVERITY_LEVELS`, `type SubCheckId`, `SUB_CHECK_NAMES`, `SUB_CHECK_RESULT_VALUES`, `TOOL_NAME` from `./metrics.ts`
  - `buildUserContent` from `./evidence.ts`
- Produces (used by `index.ts` in Task 5):
  - `type ChatClient = { chat: { completions: { create(params: Record<string, unknown>): Promise<{ choices: Array<{ message: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> }> } } }`
  - `const APPEARANCE_DEADLINE_MS: number`, `const MIN_COVERAGE_RATIO: number` (exported so tests can reference the exact thresholds)
  - `function computeInsufficientVisibilitySubCheck(bundle: EvidenceBundle): SubCheckResult` — pure, no client needed.
  - `async function runProductRepresentationAgent(bundle: EvidenceBundle, client: ChatClient): Promise<MetricResult[]>` — always returns exactly 1 result (`product_clarity`) whose `sub_checks` includes both the 4 LLM-graded checks and the deterministic `insufficient_visibility` check.

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/product_representation_agent_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPEARANCE_DEADLINE_MS,
  type ChatClient,
  computeInsufficientVisibilitySubCheck,
  MIN_COVERAGE_RATIO,
  runProductRepresentationAgent,
} from "../../../functions/product-representation-agent/agent.ts";
import { validateEvidenceBundle } from "../../../functions/product-representation-agent/evidence.ts";
import type { EvidenceBundle } from "../../../functions/shared/schemas.ts";

function makeBundle(
  overrides: Record<string, unknown> = {},
): EvidenceBundle {
  return validateEvidenceBundle({
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
    creative_brief: "Show the product clearly within the first 3 seconds.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    ...overrides,
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
                        name: "submit_product_representation_findings",
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

const PASSING_LLM_FINDING = JSON.stringify({
  result: "true",
  severity: "none",
  confidence: "high",
  evidence: [{ type: "visual", text: "Can is centered and in focus.", timestamp: "00:01" }],
  explanation: "Product is clearly shown.",
  sub_checks: [
    { check_id: "product_not_shown", result: "passed", severity: "none" },
    { check_id: "product_obscured", result: "passed", severity: "none" },
    { check_id: "product_appearance_wrong", result: "passed", severity: "none" },
    { check_id: "product_name_unspoken", result: "passed", severity: "none" },
  ],
});

Deno.test("computeInsufficientVisibilitySubCheck passes when product appears early and covers enough runtime", () => {
  const bundle = makeBundle({
    product_moments: [
      { moment_id: "m1", start_ms: 500, end_ms: 8000, frame_ids: [] },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(bundle);
  assertEquals(check.check_id, "insufficient_visibility");
  assertEquals(check.result, "passed");
  assertEquals(check.severity, "none");
});

Deno.test("computeInsufficientVisibilitySubCheck fails when the product appears late", () => {
  const bundle = makeBundle({
    product_moments: [
      {
        moment_id: "m1",
        start_ms: APPEARANCE_DEADLINE_MS + 1000,
        end_ms: APPEARANCE_DEADLINE_MS + 9000,
        frame_ids: [],
      },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(bundle);
  assertEquals(check.result, "failed");
});

Deno.test("computeInsufficientVisibilitySubCheck fails when coverage is too thin", () => {
  const bundle = makeBundle({
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    product_moments: [
      { moment_id: "m1", start_ms: 0, end_ms: 500, frame_ids: [] },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(bundle);
  assertEquals(check.result, "failed");
  assertEquals(0.5 / 15 < MIN_COVERAGE_RATIO, true);
});

Deno.test("computeInsufficientVisibilitySubCheck returns cannot_assess with no product moments", () => {
  const bundle = makeBundle({ product_moments: [] });
  const check = computeInsufficientVisibilitySubCheck(bundle);
  assertEquals(check.result, "cannot_assess");
});

Deno.test("runProductRepresentationAgent merges the LLM findings with the deterministic check", async () => {
  const bundle = makeBundle({
    product_moments: [
      { moment_id: "m1", start_ms: 500, end_ms: 8000, frame_ids: [] },
    ],
  });
  const client = makeMockClient(PASSING_LLM_FINDING);
  const results = await runProductRepresentationAgent(bundle, client);

  assertEquals(results.length, 1);
  assertEquals(results[0].metric_id, "product_clarity");
  assertEquals(results[0].agent, "product_representation");
  assertEquals(results[0].sub_checks?.length, 5);
  assertEquals(
    results[0].sub_checks?.some((sc) => sc.check_id === "insufficient_visibility"),
    true,
  );
});

Deno.test("runProductRepresentationAgent escalates severity when the deterministic check fails worse than the LLM's", async () => {
  const bundle = makeBundle({
    product_moments: [
      { moment_id: "m1", start_ms: 0, end_ms: 200, frame_ids: [] },
    ],
  });
  const client = makeMockClient(PASSING_LLM_FINDING);
  const results = await runProductRepresentationAgent(bundle, client);

  assertEquals(results[0].result, "false");
  assertEquals(results[0].severity !== "none", true);
});

Deno.test("runProductRepresentationAgent drops unknown sub_check ids from the LLM output", async () => {
  const bundle = makeBundle();
  const client = makeMockClient(
    JSON.stringify({
      result: "true",
      severity: "none",
      confidence: "high",
      evidence: [{ type: "visual", text: "ok", timestamp: "00:01" }],
      sub_checks: [
        { check_id: "made_up_check", result: "failed", severity: "high" },
        { check_id: "product_not_shown", result: "passed", severity: "none" },
      ],
    }),
  );
  const results = await runProductRepresentationAgent(bundle, client);
  const llmSubChecks = results[0].sub_checks?.filter((sc) =>
    sc.check_id !== "insufficient_visibility"
  );
  assertEquals(llmSubChecks?.length, 1);
  assertEquals(llmSubChecks?.[0].check_id, "product_not_shown");
});

Deno.test("runProductRepresentationAgent forces confidence to low when evidence is empty", async () => {
  const bundle = makeBundle();
  const client = makeMockClient(
    JSON.stringify({
      result: "false",
      severity: "high",
      confidence: "high",
      evidence: [],
      sub_checks: [],
    }),
  );
  const results = await runProductRepresentationAgent(bundle, client);
  assertEquals(results[0].confidence, "low");
});

Deno.test("runProductRepresentationAgent throws when the model returns no tool call", async () => {
  const bundle = makeBundle();
  const client: ChatClient = {
    chat: {
      completions: { create: () => Promise.resolve({ choices: [{ message: {} }] }) },
    },
  };
  let threw = false;
  try {
    await runProductRepresentationAgent(bundle, client);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/product_representation_agent_test.ts`
Expected: FAIL — `Module not found "../../../functions/product-representation-agent/agent.ts"`

- [ ] **Step 3: Implement `agent.ts`**

Create `supabase/functions/product-representation-agent/agent.ts`:

```ts
/**
 * agent.ts — Orchestration for the Product Representation Agent: the
 * deterministic screen-time coverage check, the OpenRouter tool-forced call
 * for the remaining sub-checks, and guardrails on the merged result.
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
  buildToolSchema,
  CONFIDENCE_LEVELS,
  CORRECTION_TYPES,
  EVIDENCE_TYPES,
  LLM_SUB_CHECK_IDS,
  METRIC_ID,
  METRIC_NAME,
  METRIC_QUESTION,
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
  `You are the Product Representation agent in an ad-review pipeline. You ` +
  `grade whether the advertised product is clearly represented, using only ` +
  `the product-moment scene descriptions, transcript, and on-screen text ` +
  `you are given — you never see the raw video or keyframe images. ` +
  `product_appearance_wrong can only be judged from on-screen text (OCR) ` +
  `compared against the brief's product/packaging description; return ` +
  `cannot_assess for it if there is no relevant OCR text, do not guess from ` +
  `scene descriptions alone. Grade severity (none, low, medium, high, ` +
  `critical), cite specific evidence, and self-report confidence (low, ` +
  `medium, high) — if you cannot cite specific evidence, confidence must be ` +
  `low. Call the ${TOOL_NAME} tool with your findings; do not respond with ` +
  `plain text, and do not include an insufficient_visibility sub-check — ` +
  `that one is computed separately.`;

export const APPEARANCE_DEADLINE_MS = 3000;
export const MIN_COVERAGE_RATIO = 0.15;

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
  cannot_assess: -1,
};

function worseSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

export function computeInsufficientVisibilitySubCheck(
  bundle: EvidenceBundle,
): SubCheckResult {
  const duration = bundle.video_metadata.duration_ms;
  const name = SUB_CHECK_NAMES.insufficient_visibility;

  if (!bundle.product_moments.length || !duration) {
    return {
      check_id: "insufficient_visibility",
      name,
      result: "cannot_assess",
      severity: "cannot_assess",
      explanation:
        "No product moments or video duration to compute screen-time coverage from.",
    };
  }

  const firstAppearanceMs = Math.min(
    ...bundle.product_moments.map((m) => m.start_ms),
  );
  const coveredMs = bundle.product_moments.reduce(
    (sum, m) => sum + Math.max(0, m.end_ms - m.start_ms),
    0,
  );
  const coverageRatio = coveredMs / duration;

  const late = firstAppearanceMs > APPEARANCE_DEADLINE_MS;
  const thin = coverageRatio < MIN_COVERAGE_RATIO;

  if (!late && !thin) {
    return {
      check_id: "insufficient_visibility",
      name,
      result: "passed",
      severity: "none",
    };
  }

  const severity: SeverityLevel = late && thin ? "high" : "medium";
  const reasons = [
    late
      ? `first appears at ${firstAppearanceMs}ms (after the ${APPEARANCE_DEADLINE_MS}ms deadline)`
      : "",
    thin
      ? `covers only ${(coverageRatio * 100).toFixed(1)}% of runtime (below ${
        (MIN_COVERAGE_RATIO * 100).toFixed(0)
      }%)`
      : "",
  ].filter(Boolean).join(" and ");

  return {
    check_id: "insufficient_visibility",
    name,
    result: "failed",
    severity,
    explanation: `Product ${reasons}.`,
  };
}

type RawFinding = {
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

function sanitizeSubChecks(raw: unknown): SubCheckResult[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(LLM_SUB_CHECK_IDS);
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

function buildLlmMetricResult(raw: RawFinding | undefined): MetricResult {
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

  const correctionType =
    typeof raw?.correction_type === "string" &&
      (CORRECTION_TYPES as readonly string[]).includes(raw.correction_type)
      ? (raw.correction_type as MetricResult["correction_type"])
      : "none";

  return {
    metric_id: METRIC_ID,
    agent: "product_representation",
    metric_name: METRIC_NAME,
    question: METRIC_QUESTION,
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
    sub_checks: sanitizeSubChecks(raw?.sub_checks),
  };
}

export async function runProductRepresentationAgent(
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

  let raw: RawFinding;
  try {
    raw = JSON.parse(toolCall.function.arguments) as RawFinding;
  } catch {
    throw new Error("model returned invalid JSON in tool call arguments");
  }

  const llmResult = buildLlmMetricResult(raw);
  const visibilityCheck = computeInsufficientVisibilitySubCheck(bundle);

  const finalSeverity = worseSeverity(llmResult.severity, visibilityCheck.severity);
  const finalResult: MetricResult["result"] = visibilityCheck.result === "failed"
    ? "false"
    : llmResult.result;

  return [
    {
      ...llmResult,
      result: finalResult,
      severity: finalSeverity,
      sub_checks: [...(llmResult.sub_checks ?? []), visibilityCheck],
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/product_representation_agent_test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/product-representation-agent/agent.ts supabase/tests/functions/unit/product_representation_agent_test.ts
git commit -m "feat(product-representation-agent): add deterministic visibility check and OpenRouter orchestration"
```

---

### Task 5: `index.ts` — HTTP handler wiring

**Files:**
- Modify: `supabase/functions/product-representation-agent/index.ts` (replace the doc-comment-only scaffold)
- Test: `supabase/tests/functions/unit/product_representation_index_test.ts`

**Interfaces:**
- Consumes: `verifyAuth` from `../shared/auth.ts` (existing, currently always returns `null`); `openrouter` from `../shared/claude.ts` (Task 1); `EvidenceBundle` from `../shared/schemas.ts`; `validateEvidenceBundle`, `InvalidEvidenceBundleError` from `./evidence.ts` (Task 3); `runProductRepresentationAgent`, `type ChatClient` from `./agent.ts` (Task 4).
- Produces: `async function handleRequest(req: Request, deps?: { client: ChatClient }): Promise<Response>` — the exported, directly-testable HTTP handler. `Deno.serve` wraps it with the real `openrouter` client as the default.

- [ ] **Step 1: Write the test**

Create `supabase/tests/functions/unit/product_representation_index_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleRequest } from "../../../functions/product-representation-agent/index.ts";
import type { ChatClient } from "../../../functions/product-representation-agent/agent.ts";

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
                        name: "submit_product_representation_findings",
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
    product_moments: [
      { moment_id: "m1", start_ms: 500, end_ms: 8000, frame_ids: [] },
    ],
    reference_assets: [],
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      corruption_flag: false,
      dropped_frame_markers: [],
    },
    creative_brief: "Show the product clearly within the first 3 seconds.",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
  };
}

const PASSING_LLM_FINDING = JSON.stringify({
  result: "true",
  severity: "none",
  confidence: "high",
  evidence: [{ type: "visual", text: "Can is centered and in focus.", timestamp: "00:01" }],
  sub_checks: [
    { check_id: "product_not_shown", result: "passed", severity: "none" },
    { check_id: "product_obscured", result: "passed", severity: "none" },
    { check_id: "product_appearance_wrong", result: "passed", severity: "none" },
    { check_id: "product_name_unspoken", result: "passed", severity: "none" },
  ],
});

Deno.test("handleRequest returns 400 on invalid JSON body", async () => {
  const req = new Request("http://localhost/product-representation-agent", {
    method: "POST",
    body: "not json",
  });
  const res = await handleRequest(req, { client: makeMockClient("{}") });
  assertEquals(res.status, 400);
});

Deno.test("handleRequest returns 400 on a structurally invalid EvidenceBundle", async () => {
  const req = new Request("http://localhost/product-representation-agent", {
    method: "POST",
    body: JSON.stringify({ foo: "bar" }),
  });
  const res = await handleRequest(req, { client: makeMockClient("{}") });
  assertEquals(res.status, 400);
});

Deno.test("handleRequest returns 405 on non-POST", async () => {
  const req = new Request("http://localhost/product-representation-agent", {
    method: "GET",
  });
  const res = await handleRequest(req, { client: makeMockClient("{}") });
  assertEquals(res.status, 405);
});

Deno.test("handleRequest returns 200 with a single MetricResult on success", async () => {
  const req = new Request("http://localhost/product-representation-agent", {
    method: "POST",
    body: JSON.stringify(makeValidBundleBody()),
  });
  const res = await handleRequest(req, {
    client: makeMockClient(PASSING_LLM_FINDING),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(Array.isArray(body), true);
  assertEquals(body.length, 1);
  assertEquals(body[0].metric_id, "product_clarity");
});

Deno.test("handleRequest returns 500 when the model returns no tool call", async () => {
  const badClient: ChatClient = {
    chat: {
      completions: { create: () => Promise.resolve({ choices: [{ message: {} }] }) },
    },
  };
  const req = new Request("http://localhost/product-representation-agent", {
    method: "POST",
    body: JSON.stringify(makeValidBundleBody()),
  });
  const res = await handleRequest(req, { client: badClient });
  assertEquals(res.status, 500);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd supabase && deno test tests/functions/unit/product_representation_index_test.ts`
Expected: FAIL — current `index.ts` has no exported `handleRequest` (everything is commented out).

- [ ] **Step 3: Implement `index.ts`**

Replace `supabase/functions/product-representation-agent/index.ts` (keep the existing top doc comment block describing the metrics/sub-checks as-is above the code; append the implementation below it):

```ts
import { verifyAuth } from "../shared/auth.ts";
import { openrouter } from "../shared/claude.ts";
import type { EvidenceBundle } from "../shared/schemas.ts";
import {
  InvalidEvidenceBundleError,
  validateEvidenceBundle,
} from "./evidence.ts";
import { type ChatClient, runProductRepresentationAgent } from "./agent.ts";

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
    const results = await runProductRepresentationAgent(bundle, deps.client);
    return jsonResponse(results, 200);
  } catch (err) {
    console.error("product-representation-agent failed", err);
    return jsonResponse({ error: "internal error" }, 500);
  }
}

Deno.serve((req) => handleRequest(req));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd supabase && deno test tests/functions/unit/product_representation_index_test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full unit test suite for this agent**

Run: `cd supabase && deno test tests/functions/unit/product_representation_metrics_test.ts tests/functions/unit/product_representation_evidence_test.ts tests/functions/unit/product_representation_agent_test.ts tests/functions/unit/product_representation_index_test.ts`
Expected: PASS (24 tests total)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/product-representation-agent/index.ts supabase/tests/functions/unit/product_representation_index_test.ts
git commit -m "feat(product-representation-agent): implement Deno.serve HTTP handler"
```

---

## Open notes for future work (do not action in this plan)

- `product_appearance_wrong` and the scene-description-based sub-checks are text-only approximations. Revisit once Media Processing confirms whether keyframes will carry real descriptions or images become viewable (vision).
- `APPEARANCE_DEADLINE_MS` (3000ms) and `MIN_COVERAGE_RATIO` (0.15) are placeholder defaults pending Evaluation Science's real CPG thresholds.
- After this plan, the function type-checks and its unit tests pass with a mocked client, but no real OpenRouter call has been made. To confirm live output quality, you (the user) would need to run `supabase start`, set `OPENROUTER_API_KEY`, run `supabase functions serve product-representation-agent`, and POST a real `EvidenceBundle` — that step is intentionally not automated here.
