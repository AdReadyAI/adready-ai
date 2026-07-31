"""Public-behavior tests for fixed-rate OCR reading consolidation."""

import pytest

from analyzer.ocr_consolidation import consolidate_readings
from analyzer.ocr_recognition import RawOcrReading


pytestmark = pytest.mark.unit


def test_adjacent_compatible_readings_form_ordered_ocr_segments():
    """Repeated fixed-rate readings consolidate without EAST evidence."""
    readings = (
        RawOcrReading(
            source_frame_index=0,
            timestamp_s=0.0,
            text="SALE",
            rectangle=(0.1, 0.1, 0.4, 0.2),
            confidence=None,
        ),
        RawOcrReading(
            source_frame_index=1,
            timestamp_s=0.25,
            text="SALE",
            rectangle=(0.11, 0.1, 0.4, 0.2),
            confidence=None,
        ),
        RawOcrReading(
            source_frame_index=1,
            timestamp_s=0.25,
            text="Shop now",
            rectangle=(0.2, 0.7, 0.5, 0.1),
            confidence=0.9,
        ),
    )

    segments = consolidate_readings(readings)

    assert [
        (
            segment.identifier,
            segment.text,
            segment.rectangle,
            segment.start_s,
            segment.end_s,
            segment.duration_s,
            segment.confidence,
            segment.representative_frame_index,
            segment.supporting_frame_indexes,
        )
        for segment in segments
    ] == [
        (
            "ocr_segment_0001",
            "SALE",
            (0.1, 0.1, 0.4, 0.2),
            0.0,
            0.25,
            0.25,
            None,
            0,
            (0, 1),
        ),
        (
            "ocr_segment_0002",
            "Shop now",
            (0.2, 0.7, 0.5, 0.1),
            0.25,
            0.25,
            0.0,
            0.9,
            1,
            (1,),
        ),
    ]
