"""Compose periodic selection, recognition, and OCR consolidation."""

from dataclasses import dataclass, replace
import math

import cv2

from analyzer.frame_sampling.probes.ocr_candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
    OcrCandidateStore,
)
from analyzer.frame_sampling.probes.text import TextSegment
from analyzer.ocr_consolidation import OcrSegment, consolidate_readings
from analyzer.ocr_recognition import OcrAdapter, RawOcrReading
from analyzer.types import VideoMetadata
from app.errors import PermanentError


@dataclass(frozen=True)
class FixedRateOcrAnalysis:
    """Completed in-memory OCR evidence ready for durable persistence."""

    segments: tuple[OcrSegment, ...]
    representative_candidates: tuple[OcrCandidate, ...]


class FixedRateOcrPipeline:
    """Own fixed-rate decoding, recognition, and consolidation for one OCR Run."""

    _PERIOD_SECONDS = 0.25

    def __init__(self, adapter: OcrAdapter) -> None:
        self._adapter = adapter

    def run(
        self,
        *,
        video_path: str,
        metadata: VideoMetadata,
        work_dir: str,
        text_segments: tuple[TextSegment, ...] = (),
    ) -> FixedRateOcrAnalysis:
        """Decode the Ad Creative independently and return consolidated evidence."""
        source_rate = min(metadata.fps, 1 / self._PERIOD_SECONDS)
        periodic_count = math.ceil(metadata.duration_s * source_rate)
        candidate_store = OcrCandidateStore(
            work_dir=work_dir,
            reserved_periodic_count=periodic_count,
        )

        try:
            candidates = self._decode_candidates(
                video_path=video_path,
                metadata=metadata,
                candidate_store=candidate_store,
            )
            return self._analyze(candidates, text_segments)
        except Exception:
            # A failed OCR Run must not leave temporary source candidates in
            # the shared job workspace for a later retry to misinterpret.
            candidate_store.cleanup()
            raise

    def _decode_candidates(
        self,
        *,
        video_path: str,
        metadata: VideoMetadata,
        candidate_store: OcrCandidateStore,
    ) -> tuple[OcrCandidate, ...]:
        """Select complete source frames at fixed timestamp boundaries."""
        capture = cv2.VideoCapture(video_path)
        if not capture.isOpened():
            raise PermanentError(
                f"OpenCV could not open video for OCR: {video_path}"
            )

        next_periodic_timestamp = 0.0
        final_source: tuple[int, float, object] | None = None
        try:
            index = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break

                # The worker currently records CFR-derived source timestamps.
                # True presentation timestamps remain a later decoder upgrade.
                timestamp = index / metadata.fps
                final_source = (index, timestamp, frame)
                if timestamp + 1e-9 < next_periodic_timestamp:
                    index += 1
                    continue

                # One decoded source frame covers every schedule boundary it
                # crosses; sparse media must not create duplicate OCR calls.
                while next_periodic_timestamp <= timestamp + 1e-9:
                    next_periodic_timestamp += self._PERIOD_SECONDS
                candidate_store.admit(
                    index=index,
                    timestamp=timestamp,
                    source_frame=frame,
                    model_input=None,
                    provenance=(OcrCandidateProvenance.PERIODIC,),
                )
                index += 1
        finally:
            capture.release()

        candidates = candidate_store.candidates()
        if final_source is None:
            return candidates

        final_index, final_timestamp, final_frame = final_source
        last_selected_timestamp = (
            candidates[-1].timestamp if candidates else float("-inf")
        )
        if final_timestamp - last_selected_timestamp > self._PERIOD_SECONDS:
            # Preserve the final source frame only when the periodic schedule
            # would otherwise leave more than one interval uncovered.
            candidate_store.admit(
                index=final_index,
                timestamp=final_timestamp,
                source_frame=final_frame,
                model_input=None,
                provenance=(OcrCandidateProvenance.PERIODIC,),
            )
        return candidate_store.candidates()

    def _analyze(
        self,
        candidates: tuple[OcrCandidate, ...],
        text_segments: tuple[TextSegment, ...],
    ) -> FixedRateOcrAnalysis:
        """Recognize, consolidate, and deduplicate representative frames."""
        readings: list[RawOcrReading] = []
        candidates_by_index = {
            candidate.index: candidate
            for candidate in candidates
        }

        for candidate in candidates:
            # Adapter results are already compact and normalized, so complete
            # provider payloads never enter consolidation or persistence.
            readings.extend(self._adapter.recognize(candidate))

        segments = tuple(
            self._associate_text_segments(segment, text_segments)
            for segment in consolidate_readings(tuple(readings))
        )
        representative_candidates = []
        seen_indexes = set()
        for segment in segments:
            index = segment.representative_frame_index
            if index in seen_indexes:
                continue
            representative_candidates.append(candidates_by_index[index])
            seen_indexes.add(index)

        return FixedRateOcrAnalysis(
            segments=segments,
            representative_candidates=tuple(representative_candidates),
        )

    @classmethod
    def _associate_text_segments(
        cls,
        ocr_segment: OcrSegment,
        text_segments: tuple[TextSegment, ...],
    ) -> OcrSegment:
        """Link overlapping detector evidence without making it authoritative."""
        source_ids = sorted(
            text_segment.identifier
            for text_segment in text_segments
            if text_segment.identifier
            and cls._time_intervals_overlap(ocr_segment, text_segment)
            and cls._rectangle_iou(
                ocr_segment.rectangle,
                text_segment.rectangle,
            )
            >= 0.5
        )
        return replace(
            ocr_segment,
            source_text_segment_ids=tuple(source_ids),
        )

    @staticmethod
    def _time_intervals_overlap(
        ocr_segment: OcrSegment,
        text_segment: TextSegment,
    ) -> bool:
        """Treat touching inclusive evidence intervals as temporally related."""
        return (
            ocr_segment.start_s <= text_segment.end_s
            and text_segment.start_s <= ocr_segment.end_s
        )

    @staticmethod
    def _rectangle_iou(
        left: tuple[float, float, float, float],
        right: tuple[float, float, float, float],
    ) -> float:
        """Measure normalized spatial overlap between OCR and detector regions."""
        left_x, left_y, left_width, left_height = left
        right_x, right_y, right_width, right_height = right
        intersection_width = max(
            0.0,
            min(left_x + left_width, right_x + right_width)
            - max(left_x, right_x),
        )
        intersection_height = max(
            0.0,
            min(left_y + left_height, right_y + right_height)
            - max(left_y, right_y),
        )
        intersection = intersection_width * intersection_height
        union = (
            left_width * left_height
            + right_width * right_height
            - intersection
        )
        return intersection / union if union > 0 else 0.0
