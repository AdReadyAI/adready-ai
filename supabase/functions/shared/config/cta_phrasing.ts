/**
 * cta_phrasing.ts — Platform CTA phrasing conventions (CTA: cta_platform_mismatch).
 *
 * UNRESOLVED DEPENDENCY (team does not own). Per-platform table of CTA phrasing
 * that violates current conventions — e.g. "swipe up" is stale on modern TikTok.
 * destination_platform is already an input, so only the table is missing. Until
 * it exists, cta_platform_mismatch returns cannot_assess.
 */

export type PlatformPhrasing = {
  /** Lowercased phrases that are discouraged / stale on this platform. */
  discouraged_phrases: string[];
};

/** null = unpopulated. Replace with a real table keyed by destination_platform. */
export const CTA_PHRASING: Readonly<Record<string, PlatformPhrasing>> | null =
  null;

export function getPlatformPhrasing(platform: string): PlatformPhrasing | null {
  return CTA_PHRASING?.[platform] ?? null;
}
