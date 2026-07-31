"""Public-behavior tests for the independently decoded OCR pipeline."""

import numpy as np
import pytest

import analyzer.fixed_rate_ocr_pipeline as ocr_pipeline
from analyzer.fixed_rate_ocr_pipeline import FixedRateOcrPipeline
from analyzer.frame_sampling.probes.text import TextSegment
from analyzer.ocr_recognition import (
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
