import assert from "node:assert/strict";
import {
  parseLLMJson,
  TriageResponseSchema,
} from "../../../functions/claims-agent/tools/llm-response.ts";

const goodArray = JSON.stringify([
  {
    claim_id: "c1",
    is_verifiable_claim: true,
    category: "factual_claim",
    reasoning: "x",
  },
]);

Deno.test("parseLLMJson: accepts clean JSON matching the schema", () => {
  const result = parseLLMJson(goodArray, TriageResponseSchema, "test");
  assert.equal(result.length, 1);
  assert.equal(result[0].claim_id, "c1");
});

Deno.test("parseLLMJson: strips ```json ... ``` fences", () => {
  const result = parseLLMJson(
    "```json\n" + goodArray + "\n```",
    TriageResponseSchema,
    "test",
  );
  assert.equal(result[0].claim_id, "c1");
});

Deno.test("parseLLMJson: strips plain ``` ... ``` fences", () => {
  const result = parseLLMJson(
    "```\n" + goodArray + "\n```",
    TriageResponseSchema,
    "test",
  );
  assert.equal(result[0].claim_id, "c1");
});

Deno.test("parseLLMJson: throws a clear error on non-JSON prose", () => {
  assert.throws(
    () =>
      parseLLMJson(
        "Sure, here is the analysis: claim-1 looks fine.",
        TriageResponseSchema,
        "test",
      ),
    /LLM response was not valid JSON/,
  );
});

Deno.test("parseLLMJson: throws on valid JSON with the wrong top-level shape", () => {
  assert.throws(
    () =>
      parseLLMJson(
        JSON.stringify({ not: "an array" }),
        TriageResponseSchema,
        "test",
      ),
    /did not match the expected shape/,
  );
});

Deno.test("parseLLMJson: throws on an invalid enum value", () => {
  const bad = JSON.stringify([
    {
      claim_id: "c1",
      is_verifiable_claim: true,
      category: "not_a_real_category",
      reasoning: "x",
    },
  ]);
  assert.throws(
    () => parseLLMJson(bad, TriageResponseSchema, "test"),
    /did not match the expected shape/,
  );
});

Deno.test("parseLLMJson: error message includes the failing context label", () => {
  try {
    parseLLMJson("not json", TriageResponseSchema, "my-stage");
    assert.fail("expected parseLLMJson to throw");
  } catch (e) {
    assert.ok((e as Error).message.startsWith("my-stage:"));
  }
});
