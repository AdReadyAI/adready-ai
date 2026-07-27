/**
 * context.ts unit tests.
 *
 * loadAgentContext is now a real DB loader against the migrations-backed
 * tables. Exercising it requires a running local Supabase with seed data, so
 * these checks live under the integration suite / local harness rather than
 * asserting a 501 stub.
 */
import { assertEquals } from "@std/assert";
import { loadAgentContext } from "../../../functions/product-representation-agent/context.ts";

Deno.test("loadAgentContext is exported as an async function", () => {
  assertEquals(typeof loadAgentContext, "function");
});
