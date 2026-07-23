/**
 * checks.ts — Storyline deterministic sub-checks (no model call).
 *
 * channel_readiness has a single deterministic sub-check, format_noncompliant.
 * pacing_misallocation is no longer deterministic: the AgentContext exposes
 * point-in-time visual_frames (no scene durations to sum), so pacing is judged
 * by the LLM in Call 2. format_noncompliant is a pure function of
 * (metadata, spec); it gates on the platform spec table via `gateOnConfig`.
 */

import type { SubCheckResult, VideoMetadata } from "../shared/schemas.ts";
import { failed, gateOnConfig, passed } from "../shared/subcheck.ts";
import type { PlatformSpec } from "../shared/config/index.ts";

const FORMAT = { id: "format_noncompliant", name: "Format Compliance" };

/** Parse "1920x1080" → [1920, 1080]; null when unparseable. */
function parseResolution(resolution: string): [number, number] | null {
  const m = resolution.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * format_noncompliant — aspect ratio / resolution / duration vs the platform's
 * spec row. Severity: critical (corrupt / fails ingestion) → high (wrong
 * dimensions or aspect) → medium (over the hard duration limit) → low (minor
 * duration tolerance breach) → none (all match). cannot_assess until the spec
 * table is populated.
 */
export function formatNoncompliant(
  metadata: VideoMetadata,
  spec: PlatformSpec | null,
): SubCheckResult {
  return gateOnConfig(
    spec,
    FORMAT.id,
    FORMAT.name,
    "platform technical-spec table not yet populated",
    (spec) => {
      if (metadata.corruption_detected === true) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "critical",
          "Asset is corrupted or fails platform ingestion.",
        );
      }

      const aspectOk = spec.allowed_aspect_ratios.includes(
        metadata.aspect_ratio,
      );
      const dims = parseResolution(metadata.resolution);
      const resOk = dims === null ||
        (dims[0] >= spec.min_width && dims[1] >= spec.min_height);
      if (!aspectOk || !resOk) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "high",
          `Aspect ratio/dimensions (${metadata.aspect_ratio}, ${metadata.resolution}) are wrong for the placement.`,
        );
      }

      if (metadata.duration_ms > spec.max_duration_ms) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "medium",
          `Duration ${metadata.duration_ms}ms exceeds the platform maximum.`,
        );
      }
      if (metadata.duration_ms > spec.optimal_max_duration_ms) {
        return failed(
          FORMAT.id,
          FORMAT.name,
          "low",
          `Duration ${metadata.duration_ms}ms is slightly over the optimal limit.`,
        );
      }
      return passed(FORMAT.id, FORMAT.name);
    },
  );
}
