import { assertEquals } from "@std/assert";
import { buildUserContent } from "../../../functions/brief-alignment-agent/evidence.ts";
import {
  type AgentContext,
  AgentContextSchema,
} from "../../../functions/shared/schemas.ts";

function makeContext(overrides: Record<string, unknown> = {}): AgentContext {
  return AgentContextSchema.parse({
    request_id: "11111111-1111-1111-1111-111111111111",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text:
        "Show the product in the first three seconds. Use the CTA Try Mango Moon.",
      target_audience: "Gen Z snackers",
      required_messages: ["Fun tropical snack energy"],
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
    visual_frames: [
      {
        frame_id: "f1",
        timestamp_ms: 500,
        visual_description: "A person opens a can of soda.",
      },
    ],
    product_frames: [],
    logo_frames: [],
    ...overrides,
  });
}

Deno.test("buildUserContent includes the brief, goal, transcript, and visual frames", () => {
  const content = buildUserContent(makeContext());
  assertEquals(content.includes("Try Mango Moon"), true);
  assertEquals(content.includes("CAMPAIGN GOAL: conversion"), true);
  assertEquals(content.includes("A person opens a can of soda."), true);
});

Deno.test("buildUserContent surfaces parsed brief fields", () => {
  const content = buildUserContent(makeContext());
  assertEquals(content.includes("TARGET AUDIENCE: Gen Z snackers"), true);
  assertEquals(content.includes("Fun tropical snack energy"), true);
});

Deno.test("buildUserContent renders placeholders when sections are empty", () => {
  const content = buildUserContent(
    makeContext({
      transcript_segments: [],
      ocr_segments: [],
      visual_frames: [],
    }),
  );
  assertEquals(content.includes("TRANSCRIPT:\n(none)"), true);
  assertEquals(content.includes("VISUAL FRAMES:\n(none)"), true);
});
