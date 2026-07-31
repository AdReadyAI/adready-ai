"""Public-behavior tests for deterministic OCR frame artifact storage."""

import os

import cv2
import numpy as np
import pytest

from analyzer.frame_sampling.probes.ocr_candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.ocr_frame_artifacts import LocalOcrFrameArtifactStore


pytestmark = pytest.mark.unit


def _candidate(tmp_path, index: int) -> OcrCandidate:
    """Create one source candidate file at the artifact storage seam."""
    candidate_path = tmp_path / f"candidate-{index:06d}.jpg"
    cv2.imwrite(
        str(candidate_path),
        np.full((20, 40, 3), index, dtype=np.uint8),
    )
    return OcrCandidate(
        index=index,
        timestamp=index / 20,
        model_input=None,
        path=str(candidate_path),
        source_dimensions=(40, 20),
        encoded_dimensions=(40, 20),
        scale=1.0,
        encoded_bytes=os.path.getsize(candidate_path),
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )


def test_local_artifacts_are_run_scoped_deduplicated_and_idempotent(
    tmp_path,
):
    """Repeated storage reuses one immutable artifact per supporting frame."""
    candidates = tuple(
        _candidate(tmp_path, index)
        for index in (0, 5, 10)
    )
    store = LocalOcrFrameArtifactStore(work_dir=str(tmp_path))

    first = store.store(
        ocr_run_id="ocr-run-123",
        candidates=(candidates[0], candidates[1], candidates[1], candidates[2]),
    )
    second = store.store(
        ocr_run_id="ocr-run-123",
        candidates=candidates,
    )

    assert [
        (artifact.source_frame_index, artifact.frame_id)
        for artifact in first
    ] == [
        (0, "ocr-run-123-frame-000000"),
        (5, "ocr-run-123-frame-000005"),
        (10, "ocr-run-123-frame-000010"),
    ]
    assert second == first
    assert all(os.path.isfile(artifact.path) for artifact in first)
    assert len(list((tmp_path / "ocr-artifacts" / "ocr-run-123").iterdir())) == 3
