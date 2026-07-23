/**
 * config/index.ts — Barrel for the unresolved-dependency config surface.
 *
 * Every threshold/table an agent depends on but the team does not yet own lives
 * under shared/config, each defaulting to null (unpopulated) so the dependent
 * sub-check degrades to cannot_assess via `gateOnConfig`. Populate a dependency
 * by editing its module; nothing else changes.
 */

export * from "./platform_specs.ts";
export * from "./arc_expectations.ts";
export * from "./cta_timing.ts";
export * from "./cta_visibility.ts";
export * from "./cta_phrasing.ts";
export * from "./cta_goal_benchmark.ts";
