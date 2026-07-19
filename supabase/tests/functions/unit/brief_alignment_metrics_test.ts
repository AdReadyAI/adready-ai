import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALL_SUB_CHECK_IDS,
  buildToolSchema,
  METRIC_CONFIGS,
  METRIC_IDS,
  SUB_CHECK_NAMES,
  TOOL_NAME,
} from "../../../functions/brief-alignment-agent/metrics.ts";

Deno.test("METRIC_CONFIGS covers audience_fit and brief_adherence in order", () => {
  assertEquals(METRIC_IDS, ["audience_fit", "brief_adherence"]);
  assertEquals(METRIC_CONFIGS[0].sub_check_ids, [
    "demographic_mismatch",
    "demographic_restricted",
  ]);
  assertEquals(METRIC_CONFIGS[1].sub_check_ids, [
    "objective_missed",
    "required_message_missing",
  ]);
});

Deno.test("ALL_SUB_CHECK_IDS has a name for every sub-check", () => {
  for (const id of ALL_SUB_CHECK_IDS) {
    assertEquals(typeof SUB_CHECK_NAMES[id], "string");
  }
});

Deno.test("buildToolSchema names the forced function and requires findings", () => {
  const schema = buildToolSchema();
  assertEquals(schema.function.name, TOOL_NAME);
  assertEquals(
    (schema.function.parameters as { required: string[] }).required,
    ["findings"],
  );
});
