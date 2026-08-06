import { assertEquals } from "@std/assert";
import {
  APPEARANCE_DEADLINE_MS,
  type ChatFn,
  computeInsufficientVisibilitySubCheck,
  MIN_COVERAGE_RATIO,
  runProductRepresentationAgent,
} from "../../../functions/product-representation-agent/agent.ts";
import {
  type AgentContext,
  AgentContextSchema,
} from "../../../functions/shared/schemas.ts";
import { validateMetricResults } from "../../../functions/shared/validation.ts";

function visualFrames(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    frame_id: `vf${i}`,
    timestamp_ms: i * 1000,
    visual_description: `frame ${i}`,
  }));
}

function makeContext(overrides: Record<string, unknown> = {}): AgentContext {
  return AgentContextSchema.parse({
    request_id: "11111111-1111-1111-1111-111111111111",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text: "Show the product clearly within the first 3 seconds.",
    },
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
    },
    transcript_segments: [],
    ocr_segments: [],
    visual_frames: [],
    product_frames: [],
    logo_frames: [],
    ...overrides,
  });
}

function makeMockChat(payload: string | unknown): ChatFn {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return (_messages) => Promise.resolve(body);
}

const PASSING_LLM_FINDING = {
  result: "true",
  severity: "none",
  confidence: "high",
  evidence: [{
    type: "visual",
    text: "Can is centered and in focus.",
    timestamp: "00:01",
  }],
  explanation: "Product is clearly shown.",
  sub_checks: [
    { check_id: "product_not_shown", result: "passed", severity: "none" },
    { check_id: "product_obscured", result: "passed", severity: "none" },
    {
      check_id: "product_appearance_wrong",
      result: "passed",
      severity: "none",
    },
    { check_id: "product_name_unspoken", result: "passed", severity: "none" },
  ],
};

Deno.test("computeInsufficientVisibilitySubCheck passes when product appears early and covers enough frames", () => {
  const context = makeContext({
    visual_frames: visualFrames(4),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 500,
        confidence_score: 0.9,
        prominence: "foreground_in_use",
      },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(context);
  assertEquals(check.check_id, "insufficient_visibility");
  assertEquals(check.result, "passed");
  assertEquals(check.severity, "none");
});

Deno.test("computeInsufficientVisibilitySubCheck fails when the product appears late", () => {
  const context = makeContext({
    visual_frames: visualFrames(2),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: APPEARANCE_DEADLINE_MS + 1000,
        confidence_score: 0.9,
        prominence: "foreground_in_use",
      },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(context);
  assertEquals(check.result, "failed");
});

Deno.test("computeInsufficientVisibilitySubCheck fails when frame coverage is too thin", () => {
  const context = makeContext({
    visual_frames: visualFrames(10),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 500,
        confidence_score: 0.9,
        prominence: "foreground_static",
      },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(context);
  assertEquals(check.result, "failed");
  assertEquals(1 / 10 < MIN_COVERAGE_RATIO, true);
});

Deno.test("computeInsufficientVisibilitySubCheck returns cannot_assess with no visible product frames", () => {
  const context = makeContext({ product_frames: [] });
  const check = computeInsufficientVisibilitySubCheck(context);
  assertEquals(check.result, "cannot_assess");
});

Deno.test("computeInsufficientVisibilitySubCheck ignores not_visible product frames", () => {
  const context = makeContext({
    visual_frames: visualFrames(4),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 500,
        confidence_score: 0.2,
        prominence: "not_visible",
      },
    ],
  });
  const check = computeInsufficientVisibilitySubCheck(context);
  assertEquals(check.result, "cannot_assess");
});

Deno.test("runProductRepresentationAgent merges the LLM findings with the deterministic check", async () => {
  const context = makeContext({
    visual_frames: visualFrames(4),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 500,
        confidence_score: 0.9,
        prominence: "foreground_in_use",
      },
    ],
  });
  const results = await runProductRepresentationAgent(
    context,
    makeMockChat(PASSING_LLM_FINDING),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].metric_id, "product_clarity");
  assertEquals(results[0].agent, "product_representation");
  assertEquals(results[0].sub_checks?.length, 5);
  assertEquals(
    results[0].sub_checks?.some((sc) =>
      sc.check_id === "insufficient_visibility"
    ),
    true,
  );
});

Deno.test("runProductRepresentationAgent escalates severity when the deterministic check fails worse than the LLM's", async () => {
  const context = makeContext({
    visual_frames: visualFrames(10),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 500,
        confidence_score: 0.9,
        prominence: "foreground_static",
      },
    ],
  });
  const results = await runProductRepresentationAgent(
    context,
    makeMockChat(PASSING_LLM_FINDING),
  );

  assertEquals(results[0].result, "false");
  assertEquals(results[0].severity !== "none", true);
});

Deno.test("runProductRepresentationAgent drops unknown sub_check ids from the LLM output", async () => {
  const context = makeContext();
  const results = await runProductRepresentationAgent(
    context,
    makeMockChat({
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
  const llmSubChecks = results[0].sub_checks?.filter((sc) =>
    sc.check_id !== "insufficient_visibility"
  );
  assertEquals(llmSubChecks?.length, 1);
  assertEquals(llmSubChecks?.[0].check_id, "product_not_shown");
});

Deno.test("runProductRepresentationAgent forces confidence to low when evidence is empty", async () => {
  const context = makeContext();
  const results = await runProductRepresentationAgent(
    context,
    makeMockChat({
      result: "false",
      severity: "high",
      confidence: "high",
      evidence: [],
      sub_checks: [],
    }),
  );
  assertEquals(results[0].confidence, "low");
});

Deno.test("runProductRepresentationAgent throws when the model returns invalid JSON", async () => {
  const context = makeContext();
  const chatFn: ChatFn = () => Promise.resolve("not json at all");
  let threw = false;
  try {
    await runProductRepresentationAgent(context, chatFn);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("runProductRepresentationAgent normalizes cannot_assess sub-checks so severity is cannot_assess", async () => {
  const results = await runProductRepresentationAgent(
    makeContext(),
    makeMockChat({
      result: "true",
      severity: "none",
      confidence: "high",
      evidence: [{ type: "product_page", text: "n/a", timestamp: "" }],
      sub_checks: [
        {
          check_id: "product_appearance_wrong",
          result: "cannot_assess",
          severity: "none",
        },
      ],
    }),
  );
  const sc = results[0].sub_checks?.find((c) =>
    c.check_id === "product_appearance_wrong"
  );
  assertEquals(sc?.result, "cannot_assess");
  assertEquals(sc?.severity, "cannot_assess");
});

Deno.test("runProductRepresentationAgent adds explanation + correction when the deterministic coverage check fails", async () => {
  const context = makeContext({
    visual_frames: visualFrames(10),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 500,
        confidence_score: 0.9,
        prominence: "foreground_static",
      },
    ],
  });
  const results = await runProductRepresentationAgent(
    context,
    makeMockChat({
      result: "true",
      severity: "none",
      confidence: "high",
      evidence: [{ type: "product_page", text: "clear", timestamp: "" }],
      explanation: "No representation issues.",
      correction_type: "none",
      sub_checks: [],
    }),
  );
  assertEquals(results[0].result, "false");
  assertEquals(results[0].severity !== "none", true);
  assertEquals(results[0].correction_type !== "none", true);
  assertEquals((results[0].suggested_correction ?? "").length > 0, true);
});

Deno.test("runProductRepresentationAgent output satisfies shared validateMetricResults", async () => {
  // Adversarial input: a passed sub-check reported with a non-none severity,
  // plus a late/thin coverage context that forces a failing verdict. The
  // agent's normalization must make the output pass the shared invariants.
  const context = makeContext({
    visual_frames: visualFrames(10),
    product_frames: [
      {
        frame_id: "pf1",
        timestamp_ms: 7500,
        confidence_score: 0.9,
        prominence: "foreground_static",
      },
    ],
  });
  const results = await runProductRepresentationAgent(
    context,
    makeMockChat({
      result: "true",
      severity: "none",
      confidence: "high",
      evidence: [{ type: "product_page", text: "x", timestamp: "" }],
      explanation: "No issues.",
      correction_type: "none",
      sub_checks: [
        { check_id: "product_obscured", result: "passed", severity: "high" },
      ],
    }),
  );
  // Throws if any result/severity/sub-check invariant is violated.
  const validated = validateMetricResults(results);
  assertEquals(validated.length, 1);
});
