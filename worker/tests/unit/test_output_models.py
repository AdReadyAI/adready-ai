"""Unit tests for the analysis output models (analyzer/output_models.py)."""

import pytest
from pydantic import ValidationError

pytestmark = pytest.mark.unit

from analyzer.output_models import (
    ContextResult,
    ContextRow,
    LogoFrameResult,
    LogoFrameRow,
    OcrItem,
    OcrResult,
    ProductFrameResult,
    ProductFrameRow,
    TaskFailure,
    TaskRow,
    TaskSuccess,
    TranscriptionResult,
    TranscriptSegment,
)


# ---------------------------------------------------------------------------
# TaskRow base configuration
# ---------------------------------------------------------------------------
def test_task_row_config_is_strict_frozen_and_stripped():
    config = TaskRow.model_config
    assert config["extra"] == "forbid"
    assert config["frozen"] is True
    assert config["str_strip_whitespace"] is True


# ---------------------------------------------------------------------------
# TranscriptSegment behavior (inherits TaskRow)
# ---------------------------------------------------------------------------
def test_transcript_segment_valid_construction():
    seg = TranscriptSegment(
        segment_id="tr_000",
        start_ms=0,
        end_ms=1500,
        text="hello world",
        speaker="unknown",
    )
    assert seg.segment_id == "tr_000"
    assert seg.start_ms == 0
    assert seg.end_ms == 1500
    assert seg.text == "hello world"
    assert seg.speaker == "unknown"


def test_transcript_segment_speaker_defaults_to_none():
    seg = TranscriptSegment(segment_id="tr_000", start_ms=0, end_ms=1, text="hi")
    assert seg.speaker is None


def test_transcript_segment_strips_whitespace():
    seg = TranscriptSegment(
        segment_id="  tr_000  ",
        start_ms=0,
        end_ms=1,
        text="   hello   ",
        speaker="  bob  ",
    )
    assert seg.segment_id == "tr_000"
    assert seg.text == "hello"
    assert seg.speaker == "bob"


def test_transcript_segment_is_frozen():
    seg = TranscriptSegment(segment_id="tr_000", start_ms=0, end_ms=1, text="hi")
    with pytest.raises(ValidationError):
        seg.text = "changed"


def test_transcript_segment_rejects_unknown_field():
    with pytest.raises(ValidationError):
        TranscriptSegment(
            request_id="req-1",  # not a declared field -> extra="forbid"
            segment_id="tr_000",
            start_ms=0,
            end_ms=1,
            text="hi",
        )


def test_transcript_segment_requires_mandatory_fields():
    with pytest.raises(ValidationError):
        TranscriptSegment(segment_id="tr_000")  # missing start_ms/end_ms/text


# ---------------------------------------------------------------------------
# TaskResult envelopes: table names and rows typing
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "result_cls, expected_table",
    [
        (TranscriptionResult, "transcript_segments"),
        (OcrResult, "ocr_items"),
        (ProductFrameResult, "product_frames"),
        (LogoFrameResult, "logo_frames"),
        (ContextResult, "context_results"),
    ],
)
def test_result_envelope_table_names(result_cls, expected_table):
    assert result_cls.table == expected_table


def test_transcription_result_holds_rows():
    rows = [
        TranscriptSegment(segment_id="tr_000", start_ms=0, end_ms=1, text="a"),
        TranscriptSegment(segment_id="tr_001", start_ms=1, end_ms=2, text="b"),
    ]
    result = TranscriptionResult(rows=rows)
    assert result.rows == rows
    assert all(isinstance(r, TranscriptSegment) for r in result.rows)


def test_result_envelope_accepts_empty_rows():
    assert TranscriptionResult(rows=[]).rows == []


# ---------------------------------------------------------------------------
# Placeholder row models
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("row_cls", [OcrItem, ContextRow])
def test_placeholder_rows_have_no_fields(row_cls):
    assert row_cls.model_fields == {}
    # Constructs with no arguments.
    assert row_cls() is not None


@pytest.mark.parametrize("row_cls", [OcrItem, ContextRow])
def test_placeholder_rows_reject_unknown_field(row_cls):
    with pytest.raises(ValidationError):
        row_cls(anything="x")


# ---------------------------------------------------------------------------
# ProductFrameRow / LogoFrameRow
# ---------------------------------------------------------------------------
def test_product_frame_row_valid_construction():
    row = ProductFrameRow(
        frame_id="p_000010",
        timestamp_ms=1000,
        location={"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        confidence_score=0.9,
        prominence="foreground_static",
        focus_quality="sharp",
        framing="fully_visible",
    )
    assert row.frame_id == "p_000010"
    assert row.prominence == "foreground_static"


def test_product_frame_row_rejects_bad_prominence():
    with pytest.raises(ValidationError):
        ProductFrameRow(
            frame_id="p_000010",
            timestamp_ms=1000,
            confidence_score=0.9,
            prominence="not_a_real_value",
        )


def test_logo_frame_row_valid_construction():
    row = LogoFrameRow(
        frame_id="l_000010",
        timestamp_ms=1000,
        location={"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        confidence_score=0.9,
        prominence="small_corner",
        reference_match="matches_reference",
    )
    assert row.frame_id == "l_000010"
    assert row.reference_match == "matches_reference"


def test_logo_frame_row_rejects_bad_reference_match():
    with pytest.raises(ValidationError):
        LogoFrameRow(
            frame_id="l_000010",
            timestamp_ms=1000,
            confidence_score=0.9,
            prominence="small_corner",
            reference_match="not_a_real_value",
        )


# ---------------------------------------------------------------------------
# video_processing status models
# ---------------------------------------------------------------------------
def test_task_success_defaults_and_fields():
    ok = TaskSuccess(request_id="req-1", task_name="transcription", result_table="transcript_segments")
    assert ok.status == "success"
    assert ok.result_table == "transcript_segments"
    assert ok.error is None


def test_task_failure_defaults_and_fields():
    fail = TaskFailure(request_id="req-1", task_name="transcription", error="boom")
    assert fail.status == "error"
    assert fail.error == "boom"
    assert fail.result_table is None
