"""Cost-cascaded detection and tracking of on-screen text-like regions."""

from dataclasses import dataclass, field, replace
import math
from typing import Any, Protocol

import cv2
import numpy as np

from analyzer.frame_sampling.base import (
    ProbeResult,
    ProbeSetup,
    Stage,
    register_probe,
)
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.deferred import Candidate, DeferredModelProbe
from analyzer.frame_sampling.probes.ocr_candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
    OcrCandidateStats,
    OcrCandidateStore,
)


TextCandidate = Candidate | OcrCandidate


@dataclass(frozen=True)
class TextDetection:
    """One normalized detector observation without recognized text."""

    rectangle: tuple[float, float, float, float]
    confidence: float | None
    visual_signature: str | None = None


@dataclass(frozen=True)
class TextSegment:
    """Detector-only diagnostic provenance for one tracked text-like region."""

    start_s: float
    end_s: float
    duration_s: float
    rectangle: tuple[float, float, float, float]
    detector_confidence: float | None
    representative_frame_index: int
    candidate_sources: tuple[str, ...]
    missed_observations: int
    timing_uncertainty_s: float
    identifier: str = ""


@dataclass
class _OpenTextSegment:
    """Mutable tracking state kept private until a segment closes."""

    start_s: float
    last_seen_s: float
    last_detection: TextDetection
    representative_detection: TextDetection
    representative: TextCandidate
    candidate_sources: tuple[str, ...]
    observations: list[tuple[TextDetection, TextCandidate]]
    pending_absence_s: float | None = None
    missed_observations: int = 0
    timing_uncertainty_s: float = 0.0


@dataclass
class TextProbeResult(ProbeResult):
    """Public TextProbe result returned through sampler probe results."""

    text_segments: list[TextSegment] = field(default_factory=list)
    candidate_stats: OcrCandidateStats = field(
        default_factory=OcrCandidateStats
    )


class TextRegionDetector(Protocol):
    """Adapter seam for deterministic substitutes and the later EAST model."""

    def detect_batch(self, analysis_frames: list[Any]) -> list[list[TextDetection]]:
        """Return one ordered detection collection per candidate frame."""
        ...


class _NoTextDetector:
    """Compatibility adapter used until a configured detector is supplied."""

    def detect_batch(self, analysis_frames: list[Any]) -> list[list[TextDetection]]:
        """Return explicit no-text results while preserving batch cardinality."""
        return [[] for _ in analysis_frames]


@register_probe(Stage.TEXT)
class TextProbe(DeferredModelProbe):
    """Produce detector-only Text Segments through deferred model inference."""

    name = "text"
    _GRID_ROWS = 2
    _GRID_COLUMNS = 3
    _GRID_OVERLAP = 0.05
    _EDGE_CHANGE_DELTA = 0.05
    _MISSING_TOLERANCE_S = 0.5
    _PERIODIC_FPS = 4.0

    def __init__(self, detector: TextRegionDetector | None = None) -> None:
        super().__init__()
        self._detector = detector or _NoTextDetector()
        self._previous_edge_densities: tuple[float, ...] | None = None
        self._candidate_sources: dict[int, tuple[str, ...]] = {}
        self._open_segments: list[_OpenTextSegment] = []
        self._text_segments: list[TextSegment] = []
        self._ocr_candidate_store: OcrCandidateStore | None = None
        self._next_periodic_timestamp = 0.0

    def configure(self, setup: ProbeSetup) -> None:
        """Reserve complete periodic OCR coverage inside the run work directory."""
        source_rate = min(
            setup.video_metadata.fps,
            self._PERIODIC_FPS,
        )
        periodic_count = math.ceil(
            setup.video_metadata.duration_s * source_rate
        )
        self._ocr_candidate_store = OcrCandidateStore(
            work_dir=setup.work_dir,
            reserved_periodic_count=periodic_count,
        )

    def process(self, ctx: FrameContext) -> None:
        """Collect configured OCR candidates without retaining source pixels."""
        if self._ocr_candidate_store is None:
            super().process(ctx)
            return

        self._store = ctx.store
        try:
            gate_accepted = self._gate(ctx)
            periodic = self._periodic_due(ctx.timestamp)
            if not gate_accepted and not periodic:
                return

            provenance = tuple(
                OcrCandidateProvenance(source)
                for source in self._candidate_sources.get(ctx.index, ())
            )
            if periodic:
                provenance = tuple(
                    dict.fromkeys(
                        provenance
                        + (OcrCandidateProvenance.PERIODIC,)
                    )
                )
            self._ocr_candidate_store.admit(
                index=ctx.index,
                timestamp=ctx.timestamp,
                source_frame=ctx.frame,
                model_input=self._candidate(ctx),
                provenance=provenance,
            )
        except Exception:
            self._ocr_candidate_store.cleanup()
            self._candidate_sources.clear()
            raise

    def finalize(self) -> TextProbeResult:
        """Infer configured OCR candidates and remove temporary source files."""
        if self._ocr_candidate_store is None:
            return super().finalize()

        try:
            candidates = self._ocr_candidate_store.candidates()
            for start in range(0, len(candidates), self._BATCH_SIZE):
                batch = candidates[start : start + self._BATCH_SIZE]
                results = self._batch_infer(
                    [candidate.model_input for candidate in batch]
                )
                for candidate, result in zip(batch, results):
                    self._emit(candidate, result)
            return self._result()
        except Exception:
            # Preserve the fixed-rate recall path for later OCR fallback
            # without decoding the Ad Creative a second time.
            for candidate in self._ocr_candidate_store.candidates():
                if (
                    OcrCandidateProvenance.PERIODIC
                    in candidate.provenance
                ):
                    self._keep(candidate, ("periodic",))
            raise
        finally:
            self._ocr_candidate_store.cleanup()
            self._candidate_sources.clear()

    def _gate(self, ctx: FrameContext) -> bool:
        """Select edge changes and scene cuts while resetting at cut frames."""
        densities = self._edge_densities(ctx.edges)
        previous = self._previous_edge_densities
        edge_changed = previous is None or any(
            abs(current - prior) >= self._EDGE_CHANGE_DELTA
            for current, prior in zip(densities, previous)
        )

        # Saving the current densities also establishes a fresh comparison
        # baseline when SceneProbe marks the beginning of a new shot.
        self._previous_edge_densities = densities
        sources = []
        if edge_changed:
            sources.append("edge_change")
        if ctx.shot_boundary:
            sources.append("scene_cut")
        if sources:
            self._candidate_sources[ctx.index] = tuple(sources)
        return bool(sources)

    def _candidate(self, ctx: FrameContext) -> Any:
        """Return the shared analysis-resolution pixels for deferred detection."""
        return ctx.small

    def _batch_infer(self, model_inputs: list[Any]) -> list[Any]:
        """Delegate one ordered batch to the configured detector adapter."""
        return self._detector.detect_batch(model_inputs)

    def _emit(
        self,
        candidate: TextCandidate,
        result: list[TextDetection],
    ) -> None:
        """Update matched regions and retain absence evidence per open region."""
        if isinstance(candidate, OcrCandidate):
            candidate_sources = tuple(
                source.value for source in candidate.provenance
            )
            self._candidate_sources.pop(candidate.index, None)
        else:
            candidate_sources = self._candidate_sources.pop(
                candidate.index,
                ("edge_change",),
            )
        self._close_expired_segments(candidate.timestamp)
        if not result:
            for segment in self._open_segments:
                self._mark_absent(segment, candidate.timestamp)
            return

        matched_segment_ids: set[int] = set()
        for detection in result:
            existing = self._matching_segment(
                detection,
                candidate.timestamp,
                matched_segment_ids,
            )
            if existing is not None:
                matched_segment_ids.add(id(existing))
                existing.last_seen_s = candidate.timestamp
                existing.pending_absence_s = None
                existing.last_detection = detection
                existing.observations.append((detection, candidate))
                existing.candidate_sources = tuple(
                    dict.fromkeys(existing.candidate_sources + candidate_sources)
                )
                if self._confidence(detection) > self._confidence(
                    existing.representative_detection
                ):
                    existing.representative_detection = detection
                    existing.representative = candidate
                continue

            self._open_segments.append(
                _OpenTextSegment(
                    start_s=candidate.timestamp,
                    last_seen_s=candidate.timestamp,
                    last_detection=detection,
                    representative_detection=detection,
                    representative=candidate,
                    candidate_sources=candidate_sources,
                    observations=[(detection, candidate)],
                )
            )
            matched_segment_ids.add(id(self._open_segments[-1]))

        # Assignment is one-to-one within a candidate. Any region not claimed
        # by a current detection contributes explicit disappearance evidence.
        for segment in self._open_segments:
            if id(segment) not in matched_segment_ids:
                self._mark_absent(segment, candidate.timestamp)

    def _result(self) -> TextProbeResult:
        """Return the detector-only Text Segments accumulated in source order."""
        # Without a later absence observation, the final confirming candidate is
        # the latest defensible end time at end of stream.
        if self._open_segments:
            self._close_open_segments()
        # Closure order depends on missing-observation timing, so public
        # evidence is normalized into deterministic temporal and reading order.
        self._text_segments.sort(
            key=lambda segment: (
                segment.start_s,
                segment.rectangle[1],
                segment.rectangle[0],
            )
        )
        # Identifiers follow the normalized public order and restart for every
        # probe instance, which scopes them deterministically to one OCR Run.
        self._text_segments = [
            replace(segment, identifier=f"text_segment_{position:04d}")
            for position, segment in enumerate(self._text_segments, start=1)
        ]
        candidate_stats = (
            self._ocr_candidate_store.stats
            if self._ocr_candidate_store is not None
            else OcrCandidateStats()
        )
        return TextProbeResult(
            text_segments=self._text_segments,
            candidate_stats=candidate_stats,
        )

    def _keep(
        self,
        candidate: TextCandidate,
        tags: tuple[str, ...],
    ) -> None:
        """Persist OCR representatives from either memory or candidate JPEG."""
        if not isinstance(candidate, OcrCandidate):
            super()._keep(candidate, tags)
            return
        if self._store is None:
            return

        source_frame = cv2.imread(candidate.path)
        if source_frame is None:
            raise ValueError(
                f"Could not read OCR source candidate {candidate.index}"
            )
        self._store.keep_frame(
            candidate.index,
            candidate.timestamp,
            source_frame,
            tags,
        )

    def _periodic_due(self, timestamp: float) -> bool:
        """Select the first decoded frame at each fixed 4-FPS boundary."""
        if timestamp + 1e-9 < self._next_periodic_timestamp:
            return False
        self._next_periodic_timestamp += 1 / self._PERIODIC_FPS
        return True

    def _close_open_segments(self) -> None:
        """Convert current tracking state into immutable public evidence."""
        for segment in tuple(self._open_segments):
            self._close_segment(segment)

    def _close_expired_segments(self, timestamp: float) -> None:
        """Close absent regions once their tracking tolerance has elapsed."""
        expired = [
            segment
            for segment in self._open_segments
            if segment.pending_absence_s is not None
            and timestamp - segment.last_seen_s > self._MISSING_TOLERANCE_S
        ]
        for segment in expired:
            self._close_segment(segment)

    def _close_segment(self, segment: _OpenTextSegment) -> None:
        """Finalize and remove one mutable region-tracking hypothesis."""
        end_s = (
            segment.pending_absence_s
            if segment.pending_absence_s is not None
            else segment.last_seen_s
        )
        representative_detection, representative = self._select_representative(
            segment,
            end_s,
        )
        self._text_segments.append(
            TextSegment(
                start_s=segment.start_s,
                end_s=end_s,
                duration_s=end_s - segment.start_s,
                rectangle=representative_detection.rectangle,
                detector_confidence=representative_detection.confidence,
                representative_frame_index=representative.index,
                candidate_sources=segment.candidate_sources,
                missed_observations=segment.missed_observations,
                timing_uncertainty_s=segment.timing_uncertainty_s,
            )
        )
        # Representative selection waits until closure so weaker earlier
        # observations do not create duplicate saved frames.
        self._keep(representative, (self.name,))
        self._open_segments.remove(segment)

    def _select_representative(
        self,
        segment: _OpenTextSegment,
        end_s: float,
    ) -> tuple[TextDetection, TextCandidate]:
        """Choose clear, substantial evidence nearest the visible midpoint."""
        midpoint_s = segment.start_s + (end_s - segment.start_s) / 2
        return max(
            segment.observations,
            key=lambda observation: (
                self._confidence(observation[0]),
                observation[0].rectangle[2] * observation[0].rectangle[3],
                -abs(observation[1].timestamp - midpoint_s),
                -observation[1].index,
            ),
        )

    @staticmethod
    def _mark_absent(segment: _OpenTextSegment, timestamp: float) -> None:
        """Record the first missed observation for one tracked region."""
        if segment.pending_absence_s is not None:
            return
        segment.pending_absence_s = timestamp
        segment.missed_observations += 1
        segment.timing_uncertainty_s = max(
            segment.timing_uncertainty_s,
            timestamp - segment.last_seen_s,
        )

    @staticmethod
    def _confidence(detection: TextDetection) -> float:
        """Order nullable confidence conservatively for representative choice."""
        return detection.confidence if detection.confidence is not None else -1.0

    def _matching_segment(
        self,
        detection: TextDetection,
        timestamp: float,
        excluded_segment_ids: set[int],
    ) -> _OpenTextSegment | None:
        """Conservatively associate one observation with one existing region."""
        exact = [
            segment
            for segment in self._open_segments
            if id(segment) not in excluded_segment_ids
            if segment.last_detection.rectangle == detection.rectangle
        ]
        if len(exact) == 1:
            return exact[0]
        if detection.visual_signature is None:
            return None

        plausible = [
            segment
            for segment in self._open_segments
            if id(segment) not in excluded_segment_ids
            if segment.last_detection.visual_signature == detection.visual_signature
            and timestamp - segment.last_seen_s <= 0.5
            and self._geometry_is_stable(
                segment.last_detection.rectangle,
                detection.rectangle,
            )
        ]
        # Ambiguous association deliberately opens a new segment instead of
        # guessing between simultaneously visible similar-looking regions.
        return plausible[0] if len(plausible) == 1 else None

    @staticmethod
    def _geometry_is_stable(
        previous: tuple[float, float, float, float],
        current: tuple[float, float, float, float],
    ) -> bool:
        """Allow bounded motion while requiring stable region size and shape."""
        previous_x, previous_y, previous_width, previous_height = previous
        current_x, current_y, current_width, current_height = current
        if min(previous_width, previous_height, current_width, current_height) <= 0:
            return False

        width_change = abs(current_width - previous_width) / previous_width
        height_change = abs(current_height - previous_height) / previous_height
        previous_center = (
            previous_x + previous_width / 2,
            previous_y + previous_height / 2,
        )
        current_center = (
            current_x + current_width / 2,
            current_y + current_height / 2,
        )
        center_shift = (
            (current_center[0] - previous_center[0]) ** 2
            + (current_center[1] - previous_center[1]) ** 2
        ) ** 0.5
        return width_change <= 0.2 and height_change <= 0.2 and center_shift <= 0.35

    @classmethod
    def _edge_densities(cls, edges: np.ndarray) -> tuple[float, ...]:
        """Measure one reusable edge map over an overlapping normalized grid."""
        height, width = edges.shape[:2]
        cell_height = height / cls._GRID_ROWS
        cell_width = width / cls._GRID_COLUMNS
        overlap_y = cell_height * cls._GRID_OVERLAP
        overlap_x = cell_width * cls._GRID_OVERLAP
        densities = []

        # Each region expands slightly across shared boundaries so text on a
        # grid line contributes to both neighboring change alarms.
        for row in range(cls._GRID_ROWS):
            for column in range(cls._GRID_COLUMNS):
                y0 = max(0, round(row * cell_height - overlap_y))
                y1 = min(height, round((row + 1) * cell_height + overlap_y))
                x0 = max(0, round(column * cell_width - overlap_x))
                x1 = min(width, round((column + 1) * cell_width + overlap_x))
                region = edges[y0:y1, x0:x1]
                density = float(np.count_nonzero(region) / region.size)
                densities.append(density)
        return tuple(densities)
