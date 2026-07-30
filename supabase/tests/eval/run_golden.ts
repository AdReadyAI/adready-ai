/**
 * run_golden.ts — Real-LLM eval harness for the Storyline + CTA agents.
 *
 * Runs BOTH agents against a golden AgentContext using the REAL OpenRouter-backed
 * `chat()` client (not a mock), and prints the metric_results for inspection.
 * This is a dev/eval script, not a test: it lives under tests/eval, is not run by
 * the `test:unit`/`test:integration` tasks, and it makes real network/API calls,
 * so it is deliberately outside the hermetic CI suite.
 *
 * Setup (env vars, never committed):
 *   OPENROUTER_API_KEY=sk-...        # your OpenRouter key
 *   OPENROUTER_MODEL=<provider/model># model to evaluate (confirm with eval science)
 *
 * Run (file mode — feed a golden JSON directly):
 *   deno run --allow-env --allow-net --allow-read \
 *     --config supabase/deno.json \
 *     supabase/tests/eval/run_golden.ts [path/to/golden.json]
 *
 * Run (DB mode — load the AgentContext from a local Supabase):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... (from `supabase status`)
 *   deno run --allow-env --allow-net --allow-read \
 *     --config supabase/deno.json \
 *     supabase/tests/eval/run_golden.ts --db <request_id>
 *
 * Default golden file: tests/eval/golden/mango_moon.json
 *
 * Note: the agent config tables (config.ts in each agent folder) are now populated
 * and actively drive the deterministic sub-checks, so this run exercises BOTH the
 * deterministic checks and the LLM-derived ones. A deterministic check still reports
 * cannot_assess when its dependency does not resolve for the given input — e.g. a
 * destination_platform absent from the phrasing/spec tables (cta_platform_mismatch,
 * format_noncompliant) or a campaign_goal absent from the benchmark table
 * (cta_goal_mismatch) — not because the tables are globally null.
 */

import { AgentContextSchema } from "../../functions/shared/schemas.ts";
import type {
  AgentContext,
  MetricResult,
} from "../../functions/shared/schemas.ts";
import { loadAgentContext } from "../../functions/shared/context.ts";
import { runStorylineAgent } from "../../functions/storyline-clarity-agent/agent.ts";
import { runCtaAgent } from "../../functions/cta-effectiveness-agent/agent.ts";

const DEFAULT_GOLDEN =
  new URL("./golden/mango_moon.json", import.meta.url).pathname;

// The shared loader authorizes reads by the request's owner. The seeded local DB
// owns its rows under this user; override with EVAL_USER_ID to point --db at a
// request owned by someone else.
const SEED_USER_ID = "11111111-1111-4111-8111-111111111111";

function requireEnv(name: string): void {
  if (!Deno.env.get(name)) {
    console.error(
      `✗ ${name} is not set. Export it before running (see the file header).`,
    );
    Deno.exit(1);
  }
}

function printMetric(m: MetricResult): void {
  const line =
    `  • ${m.metric_id}  →  result=${m.result}  severity=${m.severity}` +
    (m.confidence ? `  confidence=${m.confidence}` : "");
  console.log(line);
  for (const sc of m.sub_checks ?? []) {
    const detail = sc.explanation ? `  — ${sc.explanation}` : "";
    console.log(`      - ${sc.check_id}: ${sc.result}/${sc.severity}${detail}`);
  }
  if (m.explanation) console.log(`      explanation: ${m.explanation}`);
  if (m.suggested_correction) {
    console.log(`      fix: ${m.suggested_correction}`);
  }
}

/** Load the AgentContext either from the DB (--db) or a golden JSON file. */
async function loadContext(): Promise<AgentContext> {
  if (Deno.args[0] === "--db") {
    requireEnv("SUPABASE_URL");
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const requestId = Deno.args[1];
    if (!requestId) {
      console.error("✗ --db mode requires a <request_id>.");
      Deno.exit(1);
    }
    console.log(`Source: DB  request_id=${requestId}`);
    // Both agents share one full-context loader; it authorizes by owner.
    const userId = Deno.env.get("EVAL_USER_ID") ?? SEED_USER_ID;
    return await loadAgentContext(requestId, { userId });
  }

  const path = Deno.args[0] ?? DEFAULT_GOLDEN;
  const parsed = AgentContextSchema.safeParse(
    JSON.parse(await Deno.readTextFile(path)),
  );
  if (!parsed.success) {
    console.error(`✗ ${path} is not a valid AgentContext:`);
    console.error(parsed.error.toString());
    Deno.exit(1);
  }
  console.log(`Source: file  ${path}`);
  return parsed.data;
}

async function main(): Promise<void> {
  requireEnv("OPENROUTER_API_KEY");
  requireEnv("OPENROUTER_MODEL");

  const context = await loadContext();
  console.log(`Model:  ${Deno.env.get("OPENROUTER_MODEL")}\n`);

  const started = performance.now();
  // Real LLM calls happen here — both agents, each making exactly two calls.
  const [storyline, cta] = await Promise.all([
    runStorylineAgent(context),
    runCtaAgent(context),
  ]);
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);

  console.log("Storyline Clarity Agent:");
  for (const m of storyline) printMetric(m);
  console.log("\nCTA Effectiveness Agent:");
  for (const m of cta) printMetric(m);

  console.log(
    `\n${storyline.length + cta.length} metric_results in ${elapsed}s.`,
  );
}

if (import.meta.main) await main();
