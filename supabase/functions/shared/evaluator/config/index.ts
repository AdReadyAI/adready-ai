/**
 * evaluator/config/index.ts — Barrel for storyline/CTA-specific config.
 *
 * Thresholds/tables consumed only by the storyline-clarity and
 * cta-effectiveness agents. Each defaults to null (unpopulated) so the
 * dependent sub-check degrades to cannot_assess via `gateOnConfig`. Populate a
 * dependency by editing its module; nothing else changes.
 *
 * Cross-agent config (e.g. platform_specs) lives in shared/config instead.
 */

export * from "./arc_expectations.ts";
export * from "./cta_timing.ts";
export * from "./cta_visibility.ts";
export * from "./cta_phrasing.ts";
export * from "./cta_goal_benchmark.ts";
