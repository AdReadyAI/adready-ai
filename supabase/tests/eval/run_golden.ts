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
 * Note: agent config thresholds/tables are unpopulated (null), so the deterministic
 * checks report cannot_assess; this run exercises the LLM-derived sub-checks.
 */

import { AgentContextSchema } from "../../functions/shared/schemas.ts";
import type {
  AgentContext,
  MetricResult,
} from "../../functions/shared/schemas.ts";
import { loadStorylineContext } from "../../functions/storyline-clarity-agent/context.ts";
import { runStorylineAgent } from "../../functions/storyline-clarity-agent/agent.ts";
import { runCtaAgent } from "../../functions/cta-effectiveness-agent/agent.ts";

const DEFAULT_GOLDEN =
  new URL("./golden/mango_moon.json", import.meta.url).pathname;

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
    // The two per-agent context loaders are identical full-context loads.
    return await loadStorylineContext(requestId);
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
