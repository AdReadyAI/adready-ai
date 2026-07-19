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
