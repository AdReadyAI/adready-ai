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
