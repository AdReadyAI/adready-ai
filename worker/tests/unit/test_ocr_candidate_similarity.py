"""Public-behavior tests for OCR candidate visual comparison."""

import cv2
import numpy as np
import pytest

from analyzer.ocr.candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.frame_sampling.probes.text import TextSegment
from analyzer.ocr.similarity import compare_candidate_visuals


pytestmark = pytest.mark.unit


def test_identical_region_has_complete_visual_but_unknown_geometry_evidence(
    tmp_path,
) -> None:
    """Aggregate Text Segments cannot provide independent frame geometry."""
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    cv2.putText(
        image,
        "SALE",
        (25, 55),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (255, 255, 255),
        2,
    )
    candidate_path = tmp_path / "candidate.jpg"
    representative_path = tmp_path / "representative.jpg"
    assert cv2.imwrite(str(candidate_path), image)
    assert cv2.imwrite(str(representative_path), image)

    def candidate(index: int, path: str) -> OcrCandidate:
        """Build complete-frame evidence backed by the synthetic image."""
        return OcrCandidate(
            index=index,
            timestamp=index / 4,
            model_input=None,
            path=path,
            source_dimensions=(200, 100),
            encoded_dimensions=(200, 100),
            scale=1.0,
            encoded_bytes=1_000,
            provenance=(OcrCandidateProvenance.PERIODIC,),
        )

    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.5,
        duration_s=0.5,
        rectangle=(0.1, 0.2, 0.5, 0.5),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    similarity = compare_candidate_visuals(
        candidate(0, str(candidate_path)),
        candidate(2, str(representative_path)),
        text_segment,
    )

    assert similarity.spatial_overlap is None
    assert similarity.geometry_similarity is None
    assert similarity.perceptual_hash_similarity == 1.0
    assert similarity.edge_signature_similarity == 1.0
