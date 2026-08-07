import { assertEquals, assertMatch } from "@std/assert";
import {
  buildBrandResult,
  type CheckAssessment,
  evaluateLogoChecks,
} from "../../../functions/brand-alignment-agent/checks.ts";
import {
  applyGuidanceGuards,
  evaluateQualitativeChecks,
  type LLMAssessment,
  LLMCheckSchema,
} from "../../../functions/brand-alignment-agent/prompts.ts";
import type { AgentContext } from "../../../functions/shared/schemas.ts";

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    campaign_goal: "conversion",
    destination_platform: "tiktok",
    parsed_creative_brief: {
      raw_text: "Launch Mango Moon.",
      brand_voice: "playful, high-energy",
      target_audience: "Gen-Z",
      required_messages: ["tropical energy"],
      required_ctas: ["Try Mango Moon"],
      approved_claims: ["40mg caffeine"],
      forbidden_claims: [],
      brand_guidelines: ["Logo must appear in the video."],
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
        segment_id: "s1",
        start_ms: 0,
        end_ms: 3000,
        text: "Thirsty? Meet Mango Moon.",
      },
    ],
    ocr_segments: [],
    visual_frames: [],
    product_frames: [],
    logo_frames: [],
    quality_frames: [],
    product_context: undefined,
    ...overrides,
  };
}

function makeLogoFrame(
  overrides: Partial<AgentContext["logo_frames"][number]> = {},
): AgentContext["logo_frames"][number] {
  return {
    frame_id: "f1",
    timestamp_ms: 13_500,
    location: undefined,
    confidence_score: 0.95,
    prominence: "small_corner",
    reference_match: "matches_reference",
    ...overrides,
  };
}

// --- evaluateLogoChecks ---

Deno.test("evaluateLogoChecks: cannot_assess when no logo requirement or reference asset", () => {
  const ctx = makeContext({
    parsed_creative_brief: {
      raw_text: "Brief with no logo rule.",
      brand_voice: undefined,
      target_audience: undefined,
      required_messages: [],
      required_ctas: [],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
    product_context: undefined,
  });

  const result = evaluateLogoChecks(ctx);

  assertEquals(result.confidence, "low");
  assertEquals(result.checks.length, 2);
  assertEquals(result.checks.every((c) => c.result === "cannot_assess"), true);
  assertEquals(result.evidence.length, 0);
});

Deno.test("evaluateLogoChecks: logo_absent fails when brief requires logo but none detected", () => {
  const ctx = makeContext({ logo_frames: [] });
  const result = evaluateLogoChecks(ctx);

  assertEquals(result.confidence, "medium");
  assertEquals(result.checks.length, 2);
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_absent")?.result,
    "failed",
  );
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_absent")?.severity,
    "high",
  );
  // cannot assess accuracy when logo is absent
  const logoAbsent = result.checks.find((c) => c.check_id === "logo_absent");
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_incorrect")?.result,
    "cannot_assess",
  );
  // ensure explanation and evidence reflect the absent state
  assertEquals(
    logoAbsent?.explanation,
    "A logo is required by the brief or reference assets, but no reliable logo detection was found.",
  );
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_incorrect")?.explanation,
    undefined,
  );
  assertEquals(result.evidence.length, 0);
});

Deno.test("evaluateLogoChecks: both checks pass when logo present and matches reference", () => {
  const ctx = makeContext({ logo_frames: [makeLogoFrame()] });
  const result = evaluateLogoChecks(ctx);

  assertEquals(result.confidence, "high");
  assertEquals(result.checks.length, 2);
  assertEquals(result.checks.every((c) => c.result === "passed"), true);
  assertEquals(
    result.evidence.some((e) => /matches_reference/.test(e.text)),
    true,
  );
});

Deno.test("evaluateLogoChecks: logo_incorrect fails when reference_match is differs_from_reference", () => {
  const ctx = makeContext({
    logo_frames: [makeLogoFrame({ reference_match: "differs_from_reference" })],
  });
  const result = evaluateLogoChecks(ctx);

  assertEquals(result.checks.length, 2);
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_absent")?.result,
    "passed",
  );
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_incorrect")?.result,
    "failed",
  );
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_incorrect")?.severity,
    "medium",
  );
});

Deno.test("evaluateLogoChecks: frames below confidence 0.5 are treated as absent", () => {
  const ctx = makeContext({
    logo_frames: [makeLogoFrame({ confidence_score: 0.3 })],
  });
  const result = evaluateLogoChecks(ctx);

  assertEquals(result.checks.length, 2);
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_absent")?.result,
    "failed",
  );
});

Deno.test("evaluateLogoChecks: logo required via product_context.reference_asset_urls", () => {
  const ctx = makeContext({
    parsed_creative_brief: {
      raw_text: "Brief.",
      brand_voice: undefined,
      target_audience: undefined,
      required_messages: [],
      required_ctas: [],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
    product_context: {
      raw_text: undefined,
      claims: [],
      contraindications: [],
      reference_asset_urls: ["https://cdn.example.com/mango-moon-logo.png"],
    },
    logo_frames: [],
  });
  const result = evaluateLogoChecks(ctx);

  assertEquals(result.checks.length, 2);
  assertEquals(
    result.checks.find((c) => c.check_id === "logo_absent")?.result,
    "failed",
  );
});

// --- buildBrandResult ---

Deno.test("buildBrandResult: result is 'true' when all sub-checks pass", () => {
  const passing: CheckAssessment = {
    checks: [
      {
        check_id: "logo_absent",
        name: "Logo Presence",
        result: "passed",
        severity: "none",
      },
      {
        check_id: "logo_incorrect",
        name: "Logo Accuracy",
        result: "passed",
        severity: "none",
      },
    ],
    evidence: [],
    confidence: "high",
  };

  const result = buildBrandResult(passing, passing);

  assertEquals(result.metric_id, "brand_fit");
  assertEquals(result.result, "true");
  assertEquals(result.severity, "none");
  assertEquals(result.correction_type, "none");
});

Deno.test("buildBrandResult: suggested_correction targets logo_absent when it fails", () => {
  const logo: CheckAssessment = {
    checks: [
      {
        check_id: "logo_absent",
        name: "Logo Presence",
        result: "failed",
        severity: "high",
        explanation: "No logo found.",
      },
      {
        check_id: "logo_incorrect",
        name: "Logo Accuracy",
        result: "cannot_assess",
        severity: "cannot_assess",
      },
    ],
    evidence: [],
    confidence: "medium",
  };
  const qualitative: CheckAssessment = {
    checks: [
      {
        check_id: "color_palette_off",
        name: "Color Scheme",
        result: "passed",
        severity: "none",
      },
      {
        check_id: "brand_voice_drift",
        name: "Brand Voice",
        result: "passed",
        severity: "none",
      },
    ],
    evidence: [],
    confidence: "high",
  };

  const result = buildBrandResult(logo, qualitative);

  assertEquals(result.result, "false");
  assertMatch(result.suggested_correction ?? "", /logo/i);
  assertEquals(result.correction_type, "edit_recommendation");
});

Deno.test("buildBrandResult: correction_type is 'rewrite' when only brand_voice_drift fails", () => {
  const logo: CheckAssessment = {
    checks: [
      {
        check_id: "logo_absent",
        name: "Logo Presence",
        result: "passed",
        severity: "none",
      },
      {
        check_id: "logo_incorrect",
        name: "Logo Accuracy",
        result: "passed",
        severity: "none",
      },
    ],
    evidence: [],
    confidence: "high",
  };
  const qualitative: CheckAssessment = {
    checks: [
      {
        check_id: "color_palette_off",
        name: "Color Scheme",
        result: "passed",
        severity: "none",
      },
      {
        check_id: "brand_voice_drift",
        name: "Brand Voice",
        result: "failed",
        severity: "medium",
        explanation: "Too formal.",
      },
    ],
    evidence: [],
    confidence: "medium",
  };

  assertEquals(buildBrandResult(logo, qualitative).correction_type, "rewrite");
});

Deno.test("buildBrandResult: confidence is 'low' when either assessment is low", () => {
  const low: CheckAssessment = {
    checks: [{
      check_id: "logo_absent",
      name: "Logo",
      result: "passed",
      severity: "none",
    }],
    evidence: [],
    confidence: "low",
  };
  const high: CheckAssessment = {
    checks: [{
      check_id: "color_palette_off",
      name: "Color",
      result: "passed",
      severity: "none",
    }],
    evidence: [],
    confidence: "high",
  };

  assertEquals(buildBrandResult(low, high).confidence, "low");
  assertEquals(buildBrandResult(high, low).confidence, "low");
});

// --- evaluateQualitativeChecks ---

Deno.test("evaluateQualitativeChecks: cannot_assess early when no palette or voice guidance", async () => {
  const ctx = makeContext({
    parsed_creative_brief: {
      raw_text: "Brief.",
      brand_voice: undefined,
      target_audience: undefined,
      required_messages: [],
      required_ctas: [],
      approved_claims: [],
      forbidden_claims: [],
      brand_guidelines: [],
      policy_requirements: [],
    },
  });

  const result = await evaluateQualitativeChecks(ctx);

  assertEquals(result.confidence, "low");
  assertEquals(result.checks.length, 2);
  assertEquals(result.checks.every((c) => c.result === "cannot_assess"), true);
  assertEquals(result.evidence.length, 0);
});

// --- LLMCheckSchema ---

// These test the schema that parses raw LLM output. Previously untested because
// evaluateQualitativeChecks tests only exercised the early-exit path.

Deno.test("LLMCheckSchema: defaults evidence to [] when field is absent", () => {
  const parsed = LLMCheckSchema.parse({
    result: "passed",
    severity: "none",
    confidence: "high",
    explanation: "Looks good.",
    // evidence intentionally omitted
  });

  assertEquals(parsed.evidence, []);
});

Deno.test("LLMCheckSchema: accepts explicit evidence items", () => {
  const parsed = LLMCheckSchema.parse({
    result: "failed",
    severity: "medium",
    confidence: "low",
    explanation: "Palette mismatch.",
    evidence: [{
      type: "visual",
      text: "Frame at 5s shows wrong colors.",
      timestamp_ms: 5000,
    }],
  });

  assertEquals(parsed.evidence.length, 1);
  assertEquals(parsed.evidence[0].type, "visual");
});

Deno.test("LLMCheckSchema: accepts evidence items without optional timestamp_ms", () => {
  const parsed = LLMCheckSchema.parse({
    result: "passed",
    severity: "none",
    confidence: "high",
    explanation: "Fine.",
    evidence: [{ type: "brief", text: "Matches voice spec." }],
  });

  assertEquals(parsed.evidence[0].timestamp_ms, undefined);
});

// --- applyGuidanceGuards ---

// Helper to build a minimal LLMAssessment with a given result for both checks.
function makeAssessment(
  result: "passed" | "failed" | "cannot_assess",
): LLMAssessment {
  const check = {
    result,
    severity: "medium" as const,
    confidence: "high" as const,
    explanation: "test explanation",
    evidence: [{ type: "visual" as const, text: "some evidence" }],
  };
  return { color_palette_off: { ...check }, brand_voice_drift: { ...check } };
}

Deno.test("applyGuidanceGuards: overrides color_palette_off when no palette guidance", () => {
  const assessment = makeAssessment("failed");
  applyGuidanceGuards(assessment, false, true);

  assertEquals(assessment.color_palette_off.result, "cannot_assess");
  assertEquals(assessment.color_palette_off.severity, "cannot_assess");
  assertEquals(assessment.color_palette_off.confidence, "low");
  assertEquals(
    assessment.color_palette_off.explanation,
    "No palette, typography, or color guidance was supplied.",
  );
  assertEquals(assessment.color_palette_off.evidence, []);
  // voice check untouched
  assertEquals(assessment.brand_voice_drift.result, "failed");
  assertEquals(assessment.brand_voice_drift.confidence, "high");
  assertEquals(assessment.brand_voice_drift.explanation, "test explanation");
});

Deno.test("applyGuidanceGuards: overrides brand_voice_drift when no voice guidance", () => {
  const assessment = makeAssessment("failed");
  applyGuidanceGuards(assessment, true, false);

  assertEquals(assessment.brand_voice_drift.result, "cannot_assess");
  assertEquals(assessment.brand_voice_drift.severity, "cannot_assess");
  assertEquals(assessment.brand_voice_drift.confidence, "low");
  assertEquals(
    assessment.brand_voice_drift.explanation,
    "No brand voice guidance was supplied.",
  );
  assertEquals(assessment.brand_voice_drift.evidence, []);
  // palette check untouched
  assertEquals(assessment.color_palette_off.result, "failed");
  assertEquals(assessment.color_palette_off.confidence, "high");
  assertEquals(assessment.color_palette_off.explanation, "test explanation");
});

Deno.test("applyGuidanceGuards: overrides both when neither guidance present", () => {
  const assessment = makeAssessment("failed");
  applyGuidanceGuards(assessment, false, false);

  assertEquals(assessment.color_palette_off.result, "cannot_assess");
  assertEquals(assessment.color_palette_off.confidence, "low");
  assertEquals(assessment.brand_voice_drift.result, "cannot_assess");
  assertEquals(assessment.brand_voice_drift.confidence, "low");
});

Deno.test("applyGuidanceGuards: no override when both guidance present", () => {
  const assessment = makeAssessment("failed");
  applyGuidanceGuards(assessment, true, true);

  // Both checks should be untouched
  assertEquals(assessment.color_palette_off.result, "failed");
  assertEquals(assessment.brand_voice_drift.result, "failed");
  assertEquals(assessment.color_palette_off.confidence, "high");
  assertEquals(assessment.brand_voice_drift.confidence, "high");
  assertEquals(assessment.color_palette_off.explanation, "test explanation");
  assertEquals(assessment.color_palette_off.evidence.length, 1);
});
