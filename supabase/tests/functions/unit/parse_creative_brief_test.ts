import { assertEquals } from "@std/assert";
import { normalizeParsedBrief } from "../../../functions/parse-creative-brief/parser.ts";

Deno.test("normalizeParsedBrief keeps raw text authoritative and applies array defaults", () => {
  const parsed = normalizeParsedBrief(
    "Original brief text",
    JSON.stringify({
      raw_text: "model changed this",
      target_audience: "Busy parents",
      required_messages: ["Ready in 10 minutes"],
    }),
  );

  assertEquals(parsed, {
    raw_text: "Original brief text",
    target_audience: "Busy parents",
    required_messages: ["Ready in 10 minutes"],
    required_ctas: [],
    approved_claims: [],
    forbidden_claims: [],
    brand_guidelines: [],
    policy_requirements: [],
  });
});

Deno.test("normalizeParsedBrief accepts JSON wrapped in model text", () => {
  const parsed = normalizeParsedBrief(
    "Brief",
    '```json\n{"required_ctas":["Shop now"],"forbidden_claims":["Guaranteed cure"]}\n```',
  );

  assertEquals(parsed.required_ctas, ["Shop now"]);
  assertEquals(parsed.forbidden_claims, ["Guaranteed cure"]);
});
