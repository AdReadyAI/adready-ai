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
