/**
 * cta_visibility.ts — CTA text legibility thresholds (CTA: cta_low_visibility).
 *
 * UNRESOLVED DEPENDENCY (Evaluation Science). The AgentContext schema no longer
 * carries a contrast_ratio (Media dropped it, and these agents never inspect
 * pixels), so cta_low_visibility is a SIZE-only legibility check: it reads the
 * numeric region_size and font_size_px that ocr_segments[] still provide. Only
 * the thresholds are missing. Until they are set, cta_low_visibility returns
 * cannot_assess.
 */

export type CtaVisibilityThresholds = {
  /** Below this on-screen region size the CTA text is too small to register. */
  min_region_size: number;
  /** A "marginal" region-size band above min, mapping to low rather than medium. */
  marginal_region_size: number;
  /** Below this font size (px) the CTA text is illegible. */
  min_font_size_px: number;
  /** A "marginal" font-size band above min, mapping to low rather than medium. */
  marginal_font_size_px: number;
};

/** null = unpopulated. Replace with confirmed size thresholds. */
export const CTA_VISIBILITY: CtaVisibilityThresholds | null = null;

export function getCtaVisibilityThresholds(): CtaVisibilityThresholds | null {
  return CTA_VISIBILITY;
}
