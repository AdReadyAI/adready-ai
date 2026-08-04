"""Public-behavior tests for the independently decoded OCR pipeline."""

import numpy as np
import pytest

import analyzer.ocr.pipeline as ocr_pipeline
from analyzer.ocr.candidates import OcrCandidateProvenance
from analyzer.ocr.pipeline import FixedRateOcrPipeline
from analyzer.frame_sampling.probes.text import TextSegment
from analyzer.ocr.routing import (
    OcrCandidateMode,
    OcrCandidateSimilarity,
)
from analyzer.ocr.recognition import (
    DeterministicOcrAdapter,
    DeterministicOcrObservation,
)
from analyzer.types import VideoMetadata


pytestmark = pytest.mark.unit


class _FakeCapture:
    """Provide deterministic source frames at the OpenCV decoder seam."""

    def __init__(self, frames: tuple[np.ndarray, ...]) -> None:
        self._frames = iter(frames)
        self.released = False

    def isOpened(self) -> bool:
        """Report that the synthetic Ad Creative opened successfully."""
        return True

    def read(self) -> tuple[bool, np.ndarray | None]:
        """Return each source frame once, then signal end of stream."""
        try:
            return True, next(self._frames)
        except StopIteration:
            return False, None

    def release(self) -> None:
        """Record cleanup so the public test verifies decoder ownership."""
        self.released = True


def test_pipeline_independently_decodes_fixed_rate_ocr(
    tmp_path,
    monkeypatch,
):
    """OCR independently decodes full frames without the shared probe stream."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )
    metadata = VideoMetadata(
        duration_s=0.6,
        fps=20.0,
        width=200,
        height=100,
        size_bytes=1_000,
    )
    adapter = DeterministicOcrAdapter(
        observations_by_frame={
            0: (
                DeterministicOcrObservation(
                    text="SALE",
                    rectangle_pixels=(20, 10, 80, 20),
                    confidence=0.9,
                ),
            ),
            5: (
                DeterministicOcrObservation(
                    text="SALE",
                    rectangle_pixels=(20, 10, 80, 20),
                    confidence=0.9,
                ),
            ),
            10: (
                DeterministicOcrObservation(
                    text="SALE",
                    rectangle_pixels=(20, 10, 80, 20),
                    confidence=0.9,
                ),
            ),
        }
    )

    result = FixedRateOcrPipeline(adapter).run(
        video_path="synthetic.mp4",
        metadata=metadata,
        work_dir=str(tmp_path),
    )

    assert [
        (segment.text, segment.start_s, segment.end_s)
        for segment in result.segments
    ] == [("SALE", 0.0, 0.5)]
    assert [
        candidate.index
        for candidate in result.representative_candidates
    ] == [5]
    assert capture.released is True


def test_pipeline_links_overlapping_text_segment_to_ocr_segment(
    tmp_path,
    monkeypatch,
):
    """Detector evidence can inform OCR provenance without becoming required."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )
    metadata = VideoMetadata(
        duration_s=0.6,
        fps=20.0,
        width=200,
        height=100,
        size_bytes=1_000,
    )
    adapter = DeterministicOcrAdapter(
        observations_by_frame={
            index: (
                DeterministicOcrObservation(
                    text="SALE",
                    rectangle_pixels=(20, 10, 80, 20),
                    confidence=0.9,
                ),
            )
            for index in (0, 5, 10)
        }
    )
    text_segments = (
        TextSegment(
            identifier="text_segment_0001",
            start_s=0.2,
            end_s=0.55,
            duration_s=0.35,
            rectangle=(0.1, 0.1, 0.4, 0.2),
            detector_confidence=0.8,
            representative_frame_index=5,
            candidate_sources=("edge_change",),
            missed_observations=0,
            timing_uncertainty_s=0.05,
        ),
    )

    result = FixedRateOcrPipeline(adapter).run(
        video_path="synthetic.mp4",
        metadata=metadata,
        work_dir=str(tmp_path),
        text_segments=text_segments,
    )

    assert result.segments[0].source_text_segment_ids == (
        "text_segment_0001",
    )


def test_shadow_pipeline_calls_fixed_route_and_projects_detector_representative(
    tmp_path,
    monkeypatch,
) -> None:
    """Shadow comparison includes detector evidence without suppressing OCR."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )
    metadata = VideoMetadata(
        duration_s=0.6,
        fps=20.0,
        width=200,
        height=100,
        size_bytes=1_000,
    )

    class RecordingAdapter:
        """Record complete source indexes crossing the hosted OCR seam."""

        def __init__(self) -> None:
            self.source_indexes = []

        def recognize(self, candidate):
            self.source_indexes.append(candidate.index)
            return ()

    adapter = RecordingAdapter()
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.05,
        end_s=0.2,
        duration_s=0.15,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    result = FixedRateOcrPipeline(
        adapter,
        requested_mode=OcrCandidateMode.CASCADE_SHADOW,
    ).run(
        video_path="synthetic.mp4",
        metadata=metadata,
        work_dir=str(tmp_path),
        text_segments=(text_segment,),
    )

    assert adapter.source_indexes == [0, 5, 10]
    assert [
        candidate.index
        for candidate in result.routing.cascade_candidates
    ] == [0, 2, 5, 10]
    detector_candidate = result.routing.cascade_candidates[1]
    assert detector_candidate.provenance == (
        OcrCandidateProvenance.EDGE_CHANGE,
    )


def test_active_pipeline_calls_complete_conservative_candidate_union(
    tmp_path,
    monkeypatch,
) -> None:
    """Active mode recognizes periodic and detector-selected source frames."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )
    metadata = VideoMetadata(
        duration_s=0.6,
        fps=20.0,
        width=200,
        height=100,
        size_bytes=1_000,
    )

    class RecordingAdapter:
        """Record each complete source frame sent through OCR recognition."""

        def __init__(self) -> None:
            self.source_indexes = []

        def recognize(self, candidate):
            self.source_indexes.append(candidate.index)
            return ()

    adapter = RecordingAdapter()
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.05,
        end_s=0.2,
        duration_s=0.15,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    result = FixedRateOcrPipeline(
        adapter,
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
    ).run(
        video_path="synthetic.mp4",
        metadata=metadata,
        work_dir=str(tmp_path),
        text_segments=(text_segment,),
    )

    assert adapter.source_indexes == [0, 2, 5, 10]
    assert result.routing.effective_mode is OcrCandidateMode.CASCADE_ACTIVE
    assert result.routing.selected_candidates == (
        result.routing.cascade_candidates
    )


def test_active_pipeline_routes_visual_comparison_into_suppression(
    tmp_path,
    monkeypatch,
) -> None:
    """Complete comparison evidence can suppress one redundant periodic call."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )

    compared_indexes = []

    def compare_candidates(candidate, representative, segment):
        """Provide deterministic complete evidence at the image-analysis seam."""
        compared_indexes.append((candidate.index, representative.index))
        return OcrCandidateSimilarity(
            spatial_overlap=0.99,
            geometry_similarity=0.99,
            perceptual_hash_similarity=0.99,
            edge_signature_similarity=0.99,
        )

    monkeypatch.setattr(
        ocr_pipeline,
        "compare_candidate_visuals",
        compare_candidates,
    )

    class RecordingAdapter:
        """Record source indexes that remain after active routing."""

        def __init__(self) -> None:
            self.source_indexes = []

        def recognize(self, candidate):
            self.source_indexes.append(candidate.index)
            return ()

    adapter = RecordingAdapter()
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.2,
        duration_s=0.2,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    FixedRateOcrPipeline(
        adapter,
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
    ).run(
        video_path="synthetic.mp4",
        metadata=VideoMetadata(
            duration_s=0.6,
            fps=20.0,
            width=200,
            height=100,
            size_bytes=1_000,
        ),
        work_dir=str(tmp_path),
        text_segments=(text_segment,),
    )

    assert compared_indexes == [(0, 2)]
    assert adapter.source_indexes == [2, 5, 10]


def test_active_pipeline_comparison_failure_completes_fixed_fallback(
    tmp_path,
    monkeypatch,
) -> None:
    """Comparison failure completes with every periodic OCR call restored."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )

    def fail_comparison(candidate, representative, segment):
        """Simulate an unexpected failure in visual evidence generation."""
        raise RuntimeError("visual comparison failed")

    monkeypatch.setattr(
        ocr_pipeline,
        "compare_candidate_visuals",
        fail_comparison,
    )

    class RecordingAdapter:
        """Record the restored fixed-rate calls after routing fallback."""

        def __init__(self) -> None:
            self.source_indexes = []

        def recognize(self, candidate):
            self.source_indexes.append(candidate.index)
            return ()

    adapter = RecordingAdapter()
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.2,
        duration_s=0.2,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    result = FixedRateOcrPipeline(
        adapter,
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
    ).run(
        video_path="synthetic.mp4",
        metadata=VideoMetadata(
            duration_s=0.6,
            fps=20.0,
            width=200,
            height=100,
            size_bytes=1_000,
        ),
        work_dir=str(tmp_path),
        text_segments=(text_segment,),
    )

    assert adapter.source_indexes == [0, 5, 10]
    assert result.routing.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert result.routing.fallback_applied is True
    assert result.routing.fallback_reason == "candidate_comparison_failed"


def test_active_pipeline_fixed_fallback_failure_fails_and_cleans_up(
    tmp_path,
    monkeypatch,
) -> None:
    """A failed fallback OCR call fails the run without stale candidates."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(6)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )

    def fail_comparison(candidate, representative, segment):
        """Force active routing to restore the fixed-rate route."""
        raise RuntimeError("visual comparison failed")

    monkeypatch.setattr(
        ocr_pipeline,
        "compare_candidate_visuals",
        fail_comparison,
    )

    class FailingAdapter:
        """Represent failure of the hosted OCR call on the fallback route."""

        def recognize(self, candidate):
            raise RuntimeError("hosted OCR failed")

    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.2,
        duration_s=0.2,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    with pytest.raises(RuntimeError, match="hosted OCR failed"):
        FixedRateOcrPipeline(
            FailingAdapter(),
            requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        ).run(
            video_path="synthetic.mp4",
            metadata=VideoMetadata(
                duration_s=0.3,
                fps=20.0,
                width=200,
                height=100,
                size_bytes=1_000,
            ),
            work_dir=str(tmp_path),
            text_segments=(text_segment,),
        )

    assert list(tmp_path.glob("ocr-candidates-*")) == []


def test_active_pipeline_deduplicates_shared_text_segment_representative(
    tmp_path,
    monkeypatch,
) -> None:
    """Several Text Segments sharing one frame produce one hosted OCR call."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )

    class RecordingAdapter:
        """Record each source-frame index crossing the OCR adapter seam."""

        def __init__(self) -> None:
            self.source_indexes = []

        def recognize(self, candidate):
            self.source_indexes.append(candidate.index)
            return ()

    text_segments = tuple(
        TextSegment(
            identifier=f"text_segment_{position:04d}",
            start_s=0.05,
            end_s=0.2,
            duration_s=0.15,
            rectangle=rectangle,
            detector_confidence=0.9,
            representative_frame_index=2,
            candidate_sources=(source,),
            missed_observations=0,
            timing_uncertainty_s=0.0,
        )
        for position, rectangle, source in (
            (1, (0.1, 0.1, 0.3, 0.2), "edge_change"),
            (2, (0.6, 0.6, 0.3, 0.2), "scene_cut"),
        )
    )
    adapter = RecordingAdapter()

    result = FixedRateOcrPipeline(
        adapter,
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
    ).run(
        video_path="synthetic.mp4",
        metadata=VideoMetadata(
            duration_s=0.6,
            fps=20.0,
            width=200,
            height=100,
            size_bytes=1_000,
        ),
        work_dir=str(tmp_path),
        text_segments=text_segments,
    )

    assert adapter.source_indexes == [0, 2, 5, 10]
    assert adapter.source_indexes.count(2) == 1
    shared_candidate = next(
        candidate
        for candidate in result.routing.selected_candidates
        if candidate.index == 2
    )
    assert shared_candidate.provenance == (
        OcrCandidateProvenance.EDGE_CHANGE,
        OcrCandidateProvenance.SCENE_CUT,
    )


def test_active_pipeline_forwards_preexisting_cascade_failure(
    tmp_path,
    monkeypatch,
) -> None:
    """Upstream failure bypasses partial cascade evidence in the OCR pipeline."""
    frames = tuple(
        np.full((100, 200, 3), index, dtype=np.uint8)
        for index in range(11)
    )
    capture = _FakeCapture(frames)
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: capture,
    )

    def reject_comparison(candidate, representative, segment):
        """Fail if the pipeline consults invalid partial cascade evidence."""
        raise AssertionError("failed cascade must not be compared")

    monkeypatch.setattr(
        ocr_pipeline,
        "compare_candidate_visuals",
        reject_comparison,
    )

    class RecordingAdapter:
        """Record the complete periodic fallback crossing hosted OCR."""

        def __init__(self) -> None:
            self.source_indexes = []

        def recognize(self, candidate):
            self.source_indexes.append(candidate.index)
            return ()

    adapter = RecordingAdapter()
    partial_segment = TextSegment(
        identifier="text_segment_partial",
        start_s=0.0,
        end_s=0.2,
        duration_s=0.2,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    result = FixedRateOcrPipeline(
        adapter,
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
    ).run(
        video_path="synthetic.mp4",
        metadata=VideoMetadata(
            duration_s=0.6,
            fps=20.0,
            width=200,
            height=100,
            size_bytes=1_000,
        ),
        work_dir=str(tmp_path),
        text_segments=(partial_segment,),
        cascade_failure_reason="detector_failed",
    )

    assert adapter.source_indexes == [0, 5, 10]
    assert result.routing.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert result.routing.fallback_applied is True
    assert result.routing.fallback_reason == "detector_failed"
