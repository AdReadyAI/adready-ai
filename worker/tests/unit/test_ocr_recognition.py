"""Public-behavior tests for deterministic OCR recognition."""

import pytest

from analyzer.frame_sampling.probes.ocr_candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.ocr_recognition import (
    DeterministicOcrAdapter,
    DeterministicOcrObservation,
)


pytestmark = pytest.mark.unit


def test_deterministic_adapter_normalizes_raw_reading_with_provenance():
    """Fake recognition preserves text while normalizing encoded geometry."""
    candidate = OcrCandidate(
        index=7,
        timestamp=0.25,
        model_input=None,
        path="/job/ocr-candidates/000007.jpg",
        source_dimensions=(200, 100),
        encoded_dimensions=(100, 50),
        scale=0.5,
        encoded_bytes=1_000,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    adapter = DeterministicOcrAdapter(
        observations_by_frame={
            7: (
                DeterministicOcrObservation(
                    text="  Limited Offer!  ",
                    rectangle_pixels=(10, 5, 50, 10),
                    confidence=None,
                ),
            ),
        }
    )

    readings = adapter.recognize(candidate)

    assert [
        (
            reading.source_frame_index,
            reading.timestamp_s,
            reading.text,
            reading.rectangle,
            reading.confidence,
        )
        for reading in readings
    ] == [
        (
            7,
            0.25,
            "  Limited Offer!  ",
            (0.1, 0.1, 0.5, 0.2),
            None,
        ),
    ]
