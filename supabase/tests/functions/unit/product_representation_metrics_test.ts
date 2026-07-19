import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildToolSchema,
  LLM_SUB_CHECK_IDS,
  METRIC_ID,
  SUB_CHECK_NAMES,
  TOOL_NAME,
} from "../../../functions/product-representation-agent/metrics.ts";

Deno.test("METRIC_ID is product_clarity", () => {
  assertEquals(METRIC_ID, "product_clarity");
});

Deno.test("LLM_SUB_CHECK_IDS has four entries and excludes insufficient_visibility", () => {
  assertEquals(LLM_SUB_CHECK_IDS.length, 4);
  assertEquals(LLM_SUB_CHECK_IDS.includes("insufficient_visibility" as never), false);
});

Deno.test("SUB_CHECK_NAMES covers both LLM and deterministic sub-checks", () => {
  assertEquals(typeof SUB_CHECK_NAMES.insufficient_visibility, "string");
  for (const id of LLM_SUB_CHECK_IDS) {
    assertEquals(typeof SUB_CHECK_NAMES[id], "string");
  }
});

Deno.test("buildToolSchema names the forced function and excludes insufficient_visibility from sub_checks enum", () => {
  const schema = buildToolSchema();
  assertEquals(schema.function.name, TOOL_NAME);
  const params = schema.function.parameters as {
    properties: {
      sub_checks: { items: { properties: { check_id: { enum: string[] } } } };
    };
  };
  const allowedCheckIds = params.properties.sub_checks.items.properties.check_id.enum;
  assertEquals(allowedCheckIds.includes("insufficient_visibility"), false);
  assertEquals(allowedCheckIds.length, 4);
});
