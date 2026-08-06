import { assertEquals, assertStringIncludes } from "@std/assert";

import { runProductRepresentationAgent } from "../../../functions/product-representation-agent/agent.ts";
import { buildProductRepresentationResults } from "../../../functions/product-representation-agent/checks.ts";
import { buildProductRepresentationInput } from "../../../functions/product-representation-agent/prompts.ts";
import {
  parseProductRepresentationResponse,
  type ProductRepresentationResponse,
} from "../../../functions/product-representation-agent/response_schemas.ts";
import type { AgentContext } from "../../../functions/shared/schemas.ts";

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    request_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text: "Show the Mango Moon package clearly.",
      brand_voice: undefined,
      target_audience: "Young adult snack buyers",
      required_messages: [],
      required_ctas: [],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
    video_metadata: {
      duration_ms: 15_000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
    },
    transcript_segments: [
      {
        segment_id: "t1",
        start_ms: 0,
        end_ms: 1_500,
        text: "Meet Mango Moon.",
      },
    ],
    ocr_segments: [],
    visual_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        action: "A hand holds the Mango Moon package.",
        framing_composition: "Sharp centered close-up.",
        technical_flags: [],
        is_shot_start: true,
        is_fade: false,
      },
    ],
    product_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        confidence_score: 0.95,
        prominence: "foreground_in_use",
        focus_quality: "sharp",
        framing: "fully_visible",
      },
    ],
    logo_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        confidence_score: 0.9,
        prominence: "large_central",
        reference_match: "matches_reference",
      },
    ],
    quality_frames: [],
    product_context: {
      raw_text: "Mango Moon uses a coral package with a crescent logo.",
      claims: [],
      contraindications: [],
      reference_asset_urls: ["https://example.com/mango-moon.png"],
    },
    ...overrides,
  };
}

function passingResponse(): ProductRepresentationResponse {
  return {
    confidence: "high",
    evidence: [
      {
        type: "visual",
        source_id: "f1",
        text: "A hand holds the Mango Moon package in a sharp close-up.",
        timestamp: "00:00",
      },
    ],
    explanation: "The product is clearly identifiable.",
    suggested_correction: null,
    correction_type: "none",
    sub_checks: [
      {
        check_id: "product_not_shown",
        result: "passed",
        severity: "none",
        explanation: null,
      },
      {
        check_id: "product_obscured",
        result: "passed",
        severity: "none",
        explanation: null,
      },
      {
        check_id: "product_appearance_wrong",
        result: "passed",
        severity: "none",
        explanation: null,
      },
      {
        check_id: "product_name_unspoken",
        result: "passed",
        severity: "none",
        explanation: null,
      },
    ],
  };
}

Deno.test("Product prompt input joins current visual fields to detections", () => {
  const input = buildProductRepresentationInput(makeContext());

  assertStringIncludes(input, "Sharp centered close-up.");
  assertStringIncludes(input, "foreground_in_use");
  assertEquals(input.includes("visual_description"), false);
  assertEquals(input.includes("usage_context"), false);
});

Deno.test("Product prompt retains a decisive detection between former sample points", () => {
  const baseFrame = makeContext().product_frames[0];
  const productFrames = Array.from({ length: 31 }, (_, index) => ({
    ...baseFrame,
    frame_id: `f${index}`,
    timestamp_ms: index * 500,
    framing: index === 15
      ? "heavily_obscured" as const
      : "fully_visible" as const,
  }));
  const input = buildProductRepresentationInput(
    makeContext({ product_frames: productFrames }),
  );

  assertStringIncludes(input, "heavily_obscured");
  assertStringIncludes(input, '"frame_id":"f30"');
});

Deno.test("Product response parser accepts fenced JSON and rejects malformed output", () => {
  const response = passingResponse();

  assertEquals(
    parseProductRepresentationResponse(
      `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``,
    ),
    response,
  );
  assertEquals(parseProductRepresentationResponse("not json"), null);
});

Deno.test("Product result assembly emits one passing product_clarity metric", () => {
  const [result] = buildProductRepresentationResults(
    makeContext(),
    passingResponse(),
  );

  assertEquals(result.metric_id, "product_clarity");
  assertEquals(result.result, "true");
  assertEquals(result.severity, "none");
  assertEquals(result.sub_checks?.length, 4);
});

Deno.test("Product result assembly discards fabricated evidence identifiers", () => {
  const response = passingResponse();
  response.evidence[0] = {
    type: "visual",
    source_id: "fabricated-frame",
    text: "Fabricated visual citation.",
    timestamp: "99:99",
  };

  const [result] = buildProductRepresentationResults(makeContext(), response);

  assertEquals(result.evidence, []);
  assertEquals(result.confidence, "low");
});

Deno.test("Product appearance is unassessable when only an uninspected URL exists", () => {
  const context = makeContext({
    logo_frames: [],
    product_context: {
      raw_text: undefined,
      claims: [],
      contraindications: [],
      reference_asset_urls: ["https://example.com/uninspected.png"],
    },
  });
  const [result] = buildProductRepresentationResults(
    context,
    passingResponse(),
  );
  const appearance = result.sub_checks?.find((check) =>
    check.check_id === "product_appearance_wrong"
  );

  assertEquals(appearance?.result, "cannot_assess");
  assertEquals(appearance?.severity, "cannot_assess");
  assertEquals(result.result, "true");
});

Deno.test("Product appearance remains unassessable with only a logo match", () => {
  const context = makeContext({
    product_context: {
      raw_text: undefined,
      claims: [],
      contraindications: [],
      reference_asset_urls: [],
    },
  });
  const [result] = buildProductRepresentationResults(
    context,
    passingResponse(),
  );
  const appearance = result.sub_checks?.find((check) =>
    check.check_id === "product_appearance_wrong"
  );

  assertEquals(appearance?.result, "cannot_assess");
  assertEquals(appearance?.severity, "cannot_assess");
});

Deno.test("Product result assembly derives failure from checks, not correction prose", () => {
  const response = passingResponse();
  response.suggested_correction = "Optional longer pack shot.";
  response.correction_type = "edit_recommendation";
  let [result] = buildProductRepresentationResults(makeContext(), response);

  assertEquals(result.result, "true");
  assertEquals(result.correction_type, "none");
  assertEquals(result.suggested_correction, undefined);

  response.sub_checks[1] = {
    check_id: "product_obscured",
    result: "failed",
    severity: "medium",
    explanation: "The package label is heavily cropped.",
  };
  [result] = buildProductRepresentationResults(makeContext(), response);

  assertEquals(result.result, "false");
  assertEquals(result.severity, "medium");
  assertEquals(result.correction_type, "edit_recommendation");
});

Deno.test("Product agent converts malformed model output into a validated abstention", async () => {
  const [result] = await runProductRepresentationAgent(
    makeContext(),
    () => Promise.resolve("malformed response"),
  );

  assertEquals(result.result, "cannot_assess");
  assertEquals(result.severity, "cannot_assess");
  assertEquals(result.confidence, "low");
  assertEquals(
    result.sub_checks?.every((check) => check.result === "cannot_assess"),
    true,
  );
});

Deno.test("Product agent converts provider failure into its canonical abstention", async () => {
  const [result] = await runProductRepresentationAgent(
    makeContext(),
    () => Promise.reject(new Error("provider unavailable")),
  );

  assertEquals(result.metric_id, "product_clarity");
  assertEquals(result.result, "cannot_assess");
  assertEquals(result.severity, "cannot_assess");
  assertEquals(result.confidence, "low");
});
