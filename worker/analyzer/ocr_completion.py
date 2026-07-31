"""Prepare representative artifacts and evaluator rows for OCR completion."""

from dataclasses import dataclass

from analyzer.fixed_rate_ocr_pipeline import FixedRateOcrAnalysis
from analyzer.ocr_frame_artifacts import (
    OcrFrameArtifact,
    OcrFrameArtifactStore,
)
from analyzer.ocr_result import OcrResultSegment, to_ocr_result_segments


@dataclass(frozen=True)
class OcrCompletion:
    """Prepared immutable OCR evidence ready for one database completion."""

    artifacts: tuple[OcrFrameArtifact, ...]
    result_segments: tuple[OcrResultSegment, ...]


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
        return OcrCompletion(
            artifacts=artifacts,
            result_segments=to_ocr_result_segments(
                segments=analysis.segments,
                frame_ids_by_index=frame_ids_by_index,
            ),
        )
