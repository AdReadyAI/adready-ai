import { assertEquals } from "@std/assert";
import { loadAgentContext } from "../../../functions/brief-alignment-agent/context.ts";

// The DB-backed loader is a boundary until the backing tables land. It should
// throw a 501 Response, which createEdgeHandler returns verbatim to the caller.
Deno.test("loadAgentContext throws a 501 Response until DB loading is implemented", async () => {
  let thrown: unknown;
  try {
    await loadAgentContext("11111111-1111-1111-1111-111111111111");
  } catch (e) {
    thrown = e;
  }
  assertEquals(thrown instanceof Response, true);
  const res = thrown as Response;
  assertEquals(res.status, 501);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_IMPLEMENTED");
});
