"""Prepare representative artifacts and evaluator rows for OCR completion."""

from dataclasses import dataclass, replace

from analyzer.frame_sampling.probes.text import TextSegment
from analyzer.ocr.consolidation import OcrSegment
from analyzer.ocr.pipeline import FixedRateOcrAnalysis
from analyzer.ocr.frame_artifacts import (
    OcrFrameArtifact,
    OcrFrameArtifactStore,
)
from analyzer.ocr.result import OcrResultSegment, to_ocr_result_segments


@dataclass(frozen=True)
class OcrCompletion:
    """Prepared immutable OCR evidence ready for one database completion."""

    artifacts: tuple[OcrFrameArtifact, ...]
    result_segments: tuple[OcrResultSegment, ...]
    ocr_segments: tuple[OcrSegment, ...] = ()
    text_segments: tuple[TextSegment, ...] = ()


class OcrCompletionCoordinator:
    """Store representative evidence and map it into the result contract."""

    def __init__(self, *, artifact_store: OcrFrameArtifactStore) -> None:
        self._artifact_store = artifact_store

    def prepare(
        self,
        *,
        ocr_run_id: str,
        analysis: FixedRateOcrAnalysis,
    ) -> OcrCompletion:
        """Prepare one run-scoped completion without writing lifecycle state."""
        artifacts = self._artifact_store.store(
            ocr_run_id=ocr_run_id,
            candidates=analysis.representative_candidates,
        )
        frame_ids_by_index = {
            artifact.source_frame_index: artifact.frame_id
            for artifact in artifacts
        }
        text_segment_ids = {
            segment.identifier: (
                f"{ocr_run_id}-text-segment-{position:04d}"
            )
            for position, segment in enumerate(
                analysis.text_segments,
                start=1,
            )
        }
        text_segments = tuple(
            replace(
                segment,
                identifier=text_segment_ids[segment.identifier],
            )
            for segment in analysis.text_segments
        )
        ocr_segments = tuple(
            replace(
                segment,
                source_text_segment_ids=tuple(
                    text_segment_ids.get(identifier, identifier)
                    for identifier in segment.source_text_segment_ids
                ),
            )
            for segment in analysis.segments
        )
        return OcrCompletion(
            artifacts=artifacts,
            result_segments=to_ocr_result_segments(
                segments=ocr_segments,
                frame_ids_by_index=frame_ids_by_index,
            ),
            ocr_segments=ocr_segments,
            text_segments=text_segments,
        )
