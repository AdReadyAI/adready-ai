import { assertEquals } from "@std/assert";
import {
  ALL_SUB_CHECK_IDS,
  buildOutputSchema,
  METRIC_CONFIGS,
  METRIC_IDS,
  SUB_CHECK_NAMES,
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

Deno.test("buildOutputSchema requires findings for both metrics", () => {
  const schema = buildOutputSchema();
  assertEquals(schema.required, ["findings"]);
  assertEquals(
    (schema.properties.findings as { minItems: number }).minItems,
    2,
  );
});
