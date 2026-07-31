"""Public-behavior tests for preparing one immutable OCR Result."""

import os

import cv2
import numpy as np
import pytest

from analyzer.ocr.pipeline import FixedRateOcrAnalysis
from analyzer.ocr.candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.ocr.completion import OcrCompletionCoordinator
from analyzer.ocr.consolidation import OcrSegment
from analyzer.ocr.frame_artifacts import LocalOcrFrameArtifactStore


pytestmark = pytest.mark.unit


def test_completion_reuses_one_representative_across_ocr_segments(
    tmp_path,
):
    """Shared representatives produce one artifact and one reused frame ID."""
    candidate_path = tmp_path / "representative.jpg"
    cv2.imwrite(
        str(candidate_path),
        np.zeros((20, 40, 3), dtype=np.uint8),
    )
    representative = OcrCandidate(
        index=5,
        timestamp=0.25,
        model_input=None,
        path=str(candidate_path),
        source_dimensions=(40, 20),
        encoded_dimensions=(40, 20),
        scale=1.0,
        encoded_bytes=os.path.getsize(candidate_path),
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    analysis = FixedRateOcrAnalysis(
        segments=(
            OcrSegment(
                identifier="ocr_segment_0001",
                text="SALE",
                rectangle=(0.1, 0.1, 0.4, 0.2),
                start_s=0.0,
                end_s=0.5,
                duration_s=0.5,
                confidence=0.9,
                representative_frame_index=5,
                supporting_frame_indexes=(0, 5, 10),
            ),
            OcrSegment(
                identifier="ocr_segment_0002",
                text="Shop now",
                rectangle=(0.2, 0.7, 0.5, 0.1),
                start_s=0.0,
                end_s=0.5,
                duration_s=0.5,
                confidence=0.8,
                representative_frame_index=5,
                supporting_frame_indexes=(0, 5, 10),
            ),
        ),
        representative_candidates=(representative,),
    )
    coordinator = OcrCompletionCoordinator(
        artifact_store=LocalOcrFrameArtifactStore(work_dir=str(tmp_path))
    )

    completion = coordinator.prepare(
        ocr_run_id="ocr-run-123",
        analysis=analysis,
    )

    assert [
        artifact.frame_id
        for artifact in completion.artifacts
    ] == ["ocr-run-123-frame-000005"]
    assert [
        segment.frame_ids
        for segment in completion.result_segments
    ] == [
        ("ocr-run-123-frame-000005",),
        ("ocr-run-123-frame-000005",),
    ]
