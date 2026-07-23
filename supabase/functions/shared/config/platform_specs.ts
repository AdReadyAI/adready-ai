/**
 * platform_specs.ts — Platform technical-spec table (Storyline: format_noncompliant).
 *
 * UNRESOLVED DEPENDENCY (team does not own). Per-platform aspect ratio,
 * resolution, and duration limits. Until Evaluation Science / the platform team
 * supplies this table, `PLATFORM_SPECS` stays null and `format_noncompliant` —
 * and therefore the whole single-sub-check channel_readiness metric — returns
 * cannot_assess. Populate by replacing `null` with a real record keyed by
 * destination_platform; no code change is needed elsewhere.
 */

export type PlatformSpec = {
  allowed_aspect_ratios: string[]; // e.g. ["9:16"]
  min_width: number;
  min_height: number;
  optimal_max_duration_ms: number; // soft limit → low/medium tolerance breach
  max_duration_ms: number; // hard limit → high; ingestion failure → critical
};

/** null = unpopulated. Replace with a real table keyed by destination_platform. */
export const PLATFORM_SPECS: Readonly<Record<string, PlatformSpec>> | null =
  null;

export function getPlatformSpec(platform: string): PlatformSpec | null {
  return PLATFORM_SPECS?.[platform] ?? null;
}
