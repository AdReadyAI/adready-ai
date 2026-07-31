"""Public-behavior tests for evaluator-facing OCR Result mapping."""

import pytest

from analyzer.ocr_consolidation import OcrSegment
from analyzer.ocr_result import to_ocr_result_segments


pytestmark = pytest.mark.unit


def test_ocr_result_maps_segment_to_evaluator_contract() -> None:
    """Consolidated OCR evidence becomes stable evaluator-shaped data."""
    segment = OcrSegment(
        identifier="ocr_segment_0001",
        text="SALE",
        rectangle=(0.1, 0.1, 0.4, 0.2),
        start_s=0.0,
        end_s=0.25,
        duration_s=0.25,
        confidence=0.9,
        representative_frame_index=5,
        supporting_frame_indexes=(0, 5, 10),
    )

    result_segments = to_ocr_result_segments(
        segments=(segment,),
        frame_ids_by_index={
            5: "ocr-frame-000005",
        },
    )

    assert [
        (
            result.ocr_id,
            result.frame_ids,
            result.start_ms,
            result.end_ms,
            result.text,
            result.on_screen_duration_ms,
            result.region_size,
            result.font_size_px,
        )
        for result in result_segments
    ] == [
        (
            "ocr_segment_0001",
            ("ocr-frame-000005",),
            0,
            250,
            "SALE",
            250,
            8.0,
            None,
        ),
    ]
