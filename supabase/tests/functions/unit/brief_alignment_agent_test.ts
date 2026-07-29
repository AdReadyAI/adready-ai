import { assertEquals } from "@std/assert";
import {
  type ChatFn,
  runBriefAlignmentAgent,
} from "../../../functions/brief-alignment-agent/agent.ts";
import {
  type AgentContext,
  AgentContextSchema,
} from "../../../functions/shared/schemas.ts";
import { validateMetricResults } from "../../../functions/shared/validation.ts";

function makeContext(overrides: Record<string, unknown> = {}): AgentContext {
  return AgentContextSchema.parse({
    request_id: "11111111-1111-1111-1111-111111111111",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text:
        "Show the product in the first three seconds. Use the CTA Try Mango Moon.",
      required_ctas: ["Try Mango Moon"],
    },
    video_metadata: {
      duration_ms: 15000,
      aspect_ratio: "9:16",
      resolution: "1080x1920",
      dropped_frame_markers: [],
    },
    transcript_segments: [
      {
        segment_id: "t1",
        start_ms: 0,
        end_ms: 1000,
        text: "Try Mango Moon today",
      },
    ],
    ocr_segments: [],
    visual_frames: [],
    product_frames: [],
    logo_frames: [],
    ...overrides,
  });
}

function makeMockChat(payload: unknown): ChatFn {
  return (_messages) => Promise.resolve(JSON.stringify(payload));
}

Deno.test("runBriefAlignmentAgent maps a well-formed JSON reply to two MetricResults", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [
          {
            type: "transcript",
            text: "Try Mango Moon today",
            timestamp: "00:00",
          },
        ],
        explanation: "Tone matches the target audience.",
        sub_checks: [
          {
            check_id: "demographic_mismatch",
            result: "passed",
            severity: "none",
          },
          {
            check_id: "demographic_restricted",
            result: "passed",
            severity: "none",
          },
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
        suggested_correction:
          "Lead with the tropical energy message before the CTA.",
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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );

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
          {
            check_id: "demographic_mismatch",
            result: "passed",
            severity: "none",
          },
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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );

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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );

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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );

  assertEquals(results[1].metric_id, "brief_adherence");
  assertEquals(results[1].result, "cannot_assess");
});

Deno.test("runBriefAlignmentAgent throws when the model returns invalid JSON", async () => {
  const chatFn: ChatFn = () => Promise.resolve("not json at all");
  let threw = false;
  try {
    await runBriefAlignmentAgent(makeContext(), chatFn);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("runBriefAlignmentAgent recovers a sub-check labeled `check` instead of `check_id`", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "false",
        severity: "medium",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [
          {
            check: "demographic_mismatch",
            result: "failed",
            severity: "medium",
          },
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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );
  assertEquals(results[0].sub_checks?.length, 1);
  assertEquals(results[0].sub_checks?.[0].check_id, "demographic_mismatch");
});

Deno.test("runBriefAlignmentAgent forces false + non-none severity when a correction is requested", async () => {
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
        evidence: [{ type: "brief", text: "logo unconfirmed", timestamp: "" }],
        suggested_correction:
          "Confirm the logo appears in the final 3 seconds.",
        correction_type: "technical_fix",
        sub_checks: [
          { check_id: "objective_missed", result: "passed", severity: "none" },
          {
            check_id: "required_message_missing",
            result: "passed",
            severity: "none",
          },
        ],
      },
    ],
  };
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );
  const adherence = results.find((r) => r.metric_id === "brief_adherence");
  assertEquals(adherence?.result, "false");
  assertEquals(adherence?.severity !== "none", true);
});

Deno.test("runBriefAlignmentAgent bumps top-level severity when a sub-check fails but severity is none", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "true",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "ok", timestamp: "" }],
        sub_checks: [
          {
            check_id: "demographic_mismatch",
            result: "failed",
            severity: "high",
          },
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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );
  const audience = results.find((r) => r.metric_id === "audience_fit");
  assertEquals(audience?.result, "false");
  assertEquals(audience?.severity, "high");
});

Deno.test("runBriefAlignmentAgent strips corrections from a cannot_assess metric", async () => {
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "cannot_assess",
        severity: "cannot_assess",
        confidence: "low",
        evidence: [],
        suggested_correction: "Add explicit audience targeting.",
        correction_type: "edit_recommendation",
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
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );
  const audience = results.find((r) => r.metric_id === "audience_fit");
  assertEquals(audience?.result, "cannot_assess");
  assertEquals(audience?.correction_type, "none");
  assertEquals(audience?.suggested_correction, undefined);
});

Deno.test("runBriefAlignmentAgent output satisfies shared validateMetricResults", async () => {
  // Adversarial input: a failed sub-check with severity none, and a
  // cannot_assess metric reported with severity none + a correction. The
  // agent's normalization must make both pass the shared semantic invariants.
  const findings = {
    findings: [
      {
        metric_id: "audience_fit",
        result: "false",
        severity: "none",
        confidence: "high",
        evidence: [{ type: "brief", text: "x", timestamp: "" }],
        sub_checks: [
          {
            check_id: "demographic_mismatch",
            result: "failed",
            severity: "none",
          },
        ],
      },
      {
        metric_id: "brief_adherence",
        result: "cannot_assess",
        severity: "none",
        confidence: "low",
        evidence: [],
        suggested_correction: "fix it",
        correction_type: "rewrite",
        sub_checks: [],
      },
    ],
  };
  const results = await runBriefAlignmentAgent(
    makeContext(),
    makeMockChat(findings),
  );
  // Throws if any result/severity/sub-check invariant is violated.
  const validated = validateMetricResults(results);
  assertEquals(validated.length, 2);
});
