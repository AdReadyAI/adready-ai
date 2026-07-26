/**
 * config/index.ts — Barrel for the cross-agent unresolved-dependency config surface.
 *
 * Thresholds/tables that more than one agent depends on but the team does not
 * yet own live here, each defaulting to null (unpopulated) so the dependent
 * sub-check degrades to cannot_assess via `gateOnConfig`. Populate a dependency
 * by editing its module; nothing else changes.
 *
 * Storyline/CTA-specific config lives in shared/evaluator/config instead.
 */

export * from "./platform_specs.ts";
