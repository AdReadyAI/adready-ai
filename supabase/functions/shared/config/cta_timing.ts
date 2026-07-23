/**
 * cta_timing.ts — CPG CTA timing benchmarks (CTA: cta_buried, cta_mistimed).
 *
 * UNRESOLVED DEPENDENCY (Evaluation Science). The positional windows both
 * deterministic timing checks compare CTA timestamps against: the "buried"
 * early-only window (design doc's 5s), and the "lands late enough" placement
 * window (design doc's last 20–30%) with a minimum on-screen dwell. The math is
 * exact once the numbers are confirmed; until then cta_buried and cta_mistimed
 * return cannot_assess.
 */

export type CtaTiming = {
  /** A CTA seen only within this opening window (ms), never repeated, is buried. */
  buried_window_ms: number;
  /** Start of the acceptable landing zone as a fraction of runtime (e.g. 0.70). */
  landing_zone_start_fraction: number;
  /** End of the acceptable landing zone as a fraction of runtime (e.g. 1.0). */
  landing_zone_end_fraction: number;
  /** Minimum on-screen dwell (ms) for a CTA to register. */
  min_dwell_ms: number;
};

/** null = unpopulated. Replace with confirmed CPG benchmarks. */
export const CTA_TIMING: CtaTiming | null = null;

export function getCtaTiming(): CtaTiming | null {
  return CTA_TIMING;
}
