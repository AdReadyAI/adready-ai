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
