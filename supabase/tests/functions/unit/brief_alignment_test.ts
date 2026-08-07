import { assertEquals, assertStringIncludes } from "@std/assert";

import { runBriefAlignmentAgent } from "../../../functions/brief-alignment-agent/agent.ts";
import { buildBriefAlignmentResults } from "../../../functions/brief-alignment-agent/checks.ts";
import { buildBriefAlignmentInput } from "../../../functions/brief-alignment-agent/prompts.ts";
import {
  type BriefAlignmentResponse,
  parseBriefAlignmentResponse,
} from "../../../functions/brief-alignment-agent/response_schemas.ts";
import type { AgentContext } from "../../../functions/shared/schemas.ts";

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    campaign_goal: "awareness",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text: "Introduce Mango Moon to Gen Z snack buyers.",
      brand_voice: "playful",
      target_audience: "Gen Z snack buyers",
      required_messages: ["Fun tropical snack energy"],
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
        end_ms: 2_000,
        text: "Meet Mango Moon, a fun tropical snack.",
      },
    ],
    ocr_segments: [],
    visual_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        action: "A young adult opens a Mango Moon package.",
        framing_composition: "Centered product close-up.",
        technical_flags: [],
        is_shot_start: true,
        is_fade: false,
      },
    ],
    product_frames: [],
    logo_frames: [],
    quality_frames: [],
    product_context: undefined,
    ...overrides,
  };
}

function passingResponse(): BriefAlignmentResponse {
  return {
    metrics: [
      {
        metric_id: "brief_adherence",
        confidence: "high",
        evidence: [
          {
            type: "transcript",
            source_id: "t1",
            text: "Meet Mango Moon, a fun tropical snack.",
            timestamp: "00:00 - 00:02",
          },
        ],
        explanation: "The required message and awareness goal are present.",
        suggested_correction: null,
        correction_type: "none",
        sub_checks: [
          {
            check_id: "objective_missed",
            result: "passed",
            severity: "none",
            explanation: null,
          },
          {
            check_id: "required_message_missing",
            result: "passed",
            severity: "none",
            explanation: null,
          },
        ],
      },
      {
        metric_id: "audience_fit",
        confidence: "high",
        evidence: [
          {
            type: "visual",
            source_id: "f1",
            text: "A young adult opens a Mango Moon package.",
            timestamp: "00:00",
          },
        ],
        explanation: "The creative treatment matches the stated audience.",
        suggested_correction: null,
        correction_type: "none",
        sub_checks: [
          {
            check_id: "demographic_mismatch",
            result: "passed",
            severity: "none",
            explanation: null,
          },
          {
            check_id: "demographic_restricted",
            result: "passed",
            severity: "none",
            explanation: null,
          },
        ],
      },
    ],
  };
}

Deno.test("Brief prompt input uses current visual-frame fields", () => {
  const input = buildBriefAlignmentInput(makeContext());

  assertStringIncludes(input, "Centered product close-up.");
  assertStringIncludes(input, "Fun tropical snack energy");
  assertEquals(input.includes("visual_description"), false);
});

Deno.test("Brief prompt retains a decisive event between former sample points", () => {
  const transcriptSegments = Array.from({ length: 31 }, (_, index) => ({
    segment_id: `t${index}`,
    start_ms: index * 500,
    end_ms: (index + 1) * 500,
    text: index === 15
      ? "Do not show this restricted-audience warning."
      : `Neutral transcript segment ${index}`,
  }));
  const input = buildBriefAlignmentInput(
    makeContext({ transcript_segments: transcriptSegments }),
  );

  assertStringIncludes(input, "restricted-audience warning");
  assertStringIncludes(input, "Neutral transcript segment 30");
});

Deno.test("Brief response parser accepts fenced JSON and rejects malformed output", () => {
  const response = passingResponse();

  assertEquals(
    parseBriefAlignmentResponse(
      `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``,
    ),
    response,
  );
  assertEquals(parseBriefAlignmentResponse("not json"), null);
});

Deno.test("Brief result assembly emits both atomic metrics in canonical order", () => {
  const results = buildBriefAlignmentResults(makeContext(), passingResponse());

  assertEquals(results.map((result) => result.metric_id), [
    "brief_adherence",
    "audience_fit",
  ]);
  assertEquals(results.every((result) => result.result === "true"), true);
  assertEquals(results.every((result) => result.severity === "none"), true);
});

Deno.test("Brief result assembly persists only context-backed evidence", () => {
  const response = passingResponse();
  response.metrics[0].evidence[0].text = "Fabricated model paraphrase.";
  response.metrics[0].evidence.push({
    type: "transcript",
    source_id: "fabricated-segment",
    text: "Fabricated citation.",
    timestamp: "99:99",
  });

  const [result] = buildBriefAlignmentResults(makeContext(), response);

  assertEquals(result.evidence, [{
    type: "transcript",
    text: "Meet Mango Moon, a fun tropical snack.",
    timestamp: "00:00 - 00:02",
  }]);
});

Deno.test("Brief result assembly prevents absent context from becoming a pass", () => {
  const context = makeContext({
    campaign_goal: "unknown",
    parsed_creative_brief: {
      ...makeContext().parsed_creative_brief,
      raw_text: "",
      target_audience: undefined,
      required_messages: [],
    },
  });
  const results = buildBriefAlignmentResults(context, passingResponse());

  assertEquals(results[0].result, "cannot_assess");
  assertEquals(results[0].severity, "cannot_assess");
  assertEquals(results[1].result, "cannot_assess");
  assertEquals(results[1].severity, "cannot_assess");
});

Deno.test("Brief result assembly uses explicit objective and audience in raw context", () => {
  const context = makeContext({
    campaign_goal: "unknown",
    parsed_creative_brief: {
      ...makeContext().parsed_creative_brief,
      raw_text:
        "Objective: introduce Mango Moon. Audience: Gen Z snack buyers.",
      target_audience: undefined,
    },
  });
  const results = buildBriefAlignmentResults(context, passingResponse());

  assertEquals(results[0].result, "true");
  assertEquals(results[1].result, "true");
});

Deno.test("Brief result assembly derives failure from sub-checks, not correction prose", () => {
  const response = passingResponse();
  response.metrics[0].suggested_correction = "Optional wording improvement.";
  response.metrics[0].correction_type = "rewrite";
  response.metrics[1].sub_checks[0] = {
    check_id: "demographic_mismatch",
    result: "failed",
    severity: "high",
    explanation: "The formal corporate tone clashes with the stated audience.",
  };

  const results = buildBriefAlignmentResults(makeContext(), response);

  assertEquals(results[0].result, "true");
  assertEquals(results[0].correction_type, "none");
  assertEquals(results[0].suggested_correction, undefined);
  assertEquals(results[1].result, "false");
  assertEquals(results[1].severity, "high");
});

Deno.test("Brief agent converts malformed model output into validated abstentions", async () => {
  const results = await runBriefAlignmentAgent(
    makeContext(),
    () => Promise.resolve("malformed response"),
  );

  assertEquals(results.length, 2);
  assertEquals(
    results.every((result) =>
      result.result === "cannot_assess" &&
      result.severity === "cannot_assess" &&
      result.confidence === "low"
    ),
    true,
  );
});

Deno.test("Brief agent converts provider failure into canonical abstentions", async () => {
  const results = await runBriefAlignmentAgent(
    makeContext(),
    () => Promise.reject(new Error("provider unavailable")),
  );

  assertEquals(results.map((result) => result.metric_id), [
    "brief_adherence",
    "audience_fit",
  ]);
  assertEquals(
    results.every((result) =>
      result.result === "cannot_assess" &&
      result.severity === "cannot_assess" &&
      result.confidence === "low"
    ),
    true,
  );
});
