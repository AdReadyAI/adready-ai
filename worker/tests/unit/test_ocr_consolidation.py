"""Public-behavior tests for fixed-rate OCR reading consolidation."""

import pytest

from analyzer.ocr.consolidation import consolidate_readings
from analyzer.ocr.recognition import RawOcrReading


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


def test_ocr_segment_retains_ordered_supporting_readings():
    """Consolidation keeps compact frame-level Media Evidence traceable."""
    readings = (
        RawOcrReading(
            source_frame_index=4,
            timestamp_s=1.0,
            text="Save 20%",
            rectangle=(0.1, 0.2, 0.5, 0.1),
            confidence=None,
        ),
        RawOcrReading(
            source_frame_index=5,
            timestamp_s=1.25,
            text="Save 20%",
            rectangle=(0.11, 0.2, 0.5, 0.1),
            confidence=0.94,
        ),
    )

    segments = consolidate_readings(readings)

    assert segments[0].supporting_readings == readings


def test_continuously_moving_text_remains_one_ocr_segment():
    """Stable adjacent motion preserves one coherent on-screen text block."""
    readings = tuple(
        RawOcrReading(
            source_frame_index=frame_index,
            timestamp_s=timestamp_s,
            text="Swipe up",
            rectangle=rectangle,
            confidence=0.9,
        )
        for frame_index, timestamp_s, rectangle in (
            (0, 0.0, (0.10, 0.40, 0.20, 0.10)),
            (1, 0.25, (0.20, 0.40, 0.20, 0.10)),
            (2, 0.50, (0.30, 0.40, 0.20, 0.10)),
        )
    )

    segments = consolidate_readings(readings)

    assert len(segments) == 1
    assert segments[0].text == "Swipe up"
    assert segments[0].supporting_frame_indexes == (0, 1, 2)
