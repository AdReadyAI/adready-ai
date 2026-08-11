"""Unit tests for the Supabase persistence layer (app/supabase.py)."""

import pytest

pytestmark = pytest.mark.unit

from psycopg2.extras import Json

from app.supabase import Supabase, _aspect_ratio
from analyzer.frame_sampling.probes.quality import QualityFlag
from analyzer.frame_sampling.probes.scene import SceneProbeResult
from analyzer.types import VideoMetadata
from analyzer.output_models import (
    OcrItem,
    OcrResult,
    ProductFrameRow,
    TranscriptionResult,
    TranscriptSegment,
)

REQUEST_ID = "11111111-1111-1111-1111-111111111111"


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------
class FakeConnection:
    def __init__(self, autocommit=True):
        self.autocommit = autocommit
        self.commits = 0
        self.rollbacks = 0
        self.autocommit_history = []

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeCursor:
    """Records executed statements; returns queued fetch results."""

    def __init__(self, fetchone_queue=None, fetchall_result=None, autocommit=True):
        self.connection = FakeConnection(autocommit=autocommit)
        self.executed = []          # list[(sql, params)]
        self.executemany_calls = []  # list[(sql, values)]
        self._fetchone_queue = list(fetchone_queue or [])
        self._fetchall_result = fetchall_result if fetchall_result is not None else []

    def execute(self, sql, params=None):
        # Snapshot autocommit at execute time so transaction ordering is observable.
        self.connection.autocommit_history.append(self.connection.autocommit)
        self.executed.append((sql, params))

    def executemany(self, sql, values):
        self.executemany_calls.append((sql, list(values)))

    def fetchone(self):
        if self._fetchone_queue:
            return self._fetchone_queue.pop(0)
        return ("processing-id",)

    def fetchall(self):
        return list(self._fetchall_result)


def _segment(idx=0):
    return TranscriptSegment(
        segment_id=f"tr_{idx:03d}",
        start_ms=idx * 1000,
        end_ms=(idx + 1) * 1000,
        text=f"line {idx}",
        speaker="unknown",
    )


# ---------------------------------------------------------------------------
# transaction()
# ---------------------------------------------------------------------------
def test_transaction_commits_on_success_and_restores_autocommit():
    cur = FakeCursor(autocommit=True)
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    with db.transaction() as yielded:
        assert yielded is cur
        assert cur.connection.autocommit is False  # disabled inside the block

    assert cur.connection.commits == 1
    assert cur.connection.rollbacks == 0
    assert cur.connection.autocommit is True  # restored


def test_transaction_rolls_back_and_reraises_on_error():
    cur = FakeCursor(autocommit=True)
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    with pytest.raises(ValueError):
        with db.transaction():
            raise ValueError("boom")

    assert cur.connection.commits == 0
    assert cur.connection.rollbacks == 1
    assert cur.connection.autocommit is True  # restored even on failure


def test_transaction_restores_previous_autocommit_when_already_false():
    cur = FakeCursor(autocommit=False)
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    with db.transaction():
        pass

    assert cur.connection.autocommit is False


# ---------------------------------------------------------------------------
# mark_processing()
# ---------------------------------------------------------------------------
def test_mark_processing_upserts_processing_status():
    cur = FakeCursor(fetchone_queue=[("proc-1",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.mark_processing("transcription")

    sql, params = cur.executed[0]
    assert "INSERT INTO video_processing" in sql
    assert "ON CONFLICT (request_id, task_name)" in sql
    assert params == (REQUEST_ID, "transcription", "processing", None, None)


# ---------------------------------------------------------------------------
# media_processing_status lifecycle
# ---------------------------------------------------------------------------
def test_mark_media_processing_started_sets_processing_status():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.mark_media_processing_started()

    sql, params = cur.executed[0]
    assert "UPDATE requests" in sql
    assert params == ("processing", None, None, REQUEST_ID)


def test_mark_media_processing_completed_sets_completed_status():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.mark_media_processing_completed()

    sql, params = cur.executed[0]
    assert "UPDATE requests" in sql
    assert params == ("completed", None, None, REQUEST_ID)


def test_mark_media_processing_failed_sets_failed_status_and_error():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.mark_media_processing_failed("boom")

    sql, params = cur.executed[0]
    assert "UPDATE requests" in sql
    assert params == (
        "failed",
        "boom",
        "media_processing_failed",
        REQUEST_ID,
    )


def test_record_media_processing_error_updates_error_only():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.record_media_processing_error("storage 503")

    sql, params = cur.executed[0]
    assert "UPDATE requests" in sql
    assert "media_processing_status" not in sql
    assert params == ("storage 503", REQUEST_ID)


def test_mark_media_processing_exhausted_updates_status_only():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.mark_media_processing_exhausted()

    sql, params = cur.executed[0]
    assert "UPDATE requests" in sql
    assert "media_processing_error" not in sql
    assert "media_processing_failure_code = 'media_processing_retries_exhausted'" in sql
    assert params == (REQUEST_ID,)


# ---------------------------------------------------------------------------
# completed_analyzers()
# ---------------------------------------------------------------------------
def test_completed_analyzers_returns_successful_task_names():
    cur = FakeCursor(fetchall_result=[("transcription",), ("ocr",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    done = db.completed_analyzers()

    assert done == {"transcription", "ocr"}
    sql, params = cur.executed[0]
    assert "FROM video_processing" in sql
    assert "status = 'success'" in sql
    assert params == (REQUEST_ID,)


def test_completed_analyzers_empty():
    cur = FakeCursor(fetchall_result=[])
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    assert db.completed_analyzers() == set()


# ---------------------------------------------------------------------------
# _upsert_processing()
# ---------------------------------------------------------------------------
def test_upsert_processing_issues_upsert_and_returns_id():
    cur = FakeCursor(fetchone_queue=[("proc-123",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    processing_id = db._upsert_processing("transcription", "success", "transcript_segments")

    assert processing_id == "proc-123"
    sql, params = cur.executed[0]
    assert "INSERT INTO video_processing" in sql
    assert "ON CONFLICT (request_id, task_name)" in sql
    assert "RETURNING id" in sql
    assert params == (REQUEST_ID, "transcription", "success", "transcript_segments", None)


def test_upsert_processing_passes_error_message():
    cur = FakeCursor(fetchone_queue=[("proc-err",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db._upsert_processing("transcription", "error", None, "kaboom")

    _, params = cur.executed[0]
    assert params == (REQUEST_ID, "transcription", "error", None, "kaboom")


# ---------------------------------------------------------------------------
# _replace_rows()
# ---------------------------------------------------------------------------
def test_replace_rows_deletes_then_inserts():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    rows = [_segment(0), _segment(1)]

    db._replace_rows("transcript_segments", "proc-1", rows)

    delete_sql, delete_params = cur.executed[0]
    assert delete_sql == "DELETE FROM transcript_segments WHERE processing_id = %s;"
    assert delete_params == ("proc-1",)

    assert len(cur.executemany_calls) == 1
    insert_sql, values = cur.executemany_calls[0]
    assert "INSERT INTO transcript_segments" in insert_sql
    assert "(processing_id, segment_id, start_ms, end_ms, text, speaker)" in insert_sql
    assert values[0] == ("proc-1", "tr_000", 0, 1000, "line 0", "unknown")
    assert values[1] == ("proc-1", "tr_001", 1000, 2000, "line 1", "unknown")


def test_replace_rows_empty_deletes_only():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db._replace_rows("transcript_segments", "proc-1", [])

    assert cur.executed[0][0].startswith("DELETE FROM transcript_segments")
    assert cur.executemany_calls == []


def test_replace_rows_placeholder_row_with_no_fields():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db._replace_rows("ocr_items", "proc-1", [OcrItem()])

    insert_sql, values = cur.executemany_calls[0]
    assert "INSERT INTO ocr_items (processing_id) VALUES (%s);" == insert_sql
    assert values == [("proc-1",)]


def test_replace_rows_wraps_dict_fields_for_jsonb():
    """product_frames/logo_frames.location is jsonb; a raw dict has no psycopg2
    adapter, so it must be wrapped (e.g. psycopg2.extras.Json) before insert."""
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    row = ProductFrameRow(
        frame_id="p_000001",
        timestamp_ms=1000,
        location={"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        confidence_score=0.9,
        prominence="foreground_static",
    )

    db._replace_rows("product_frames", "proc-1", [row])

    _, values = cur.executemany_calls[0]
    location_value = values[0][3]
    assert isinstance(location_value, Json)
    assert location_value.adapted == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}


# ---------------------------------------------------------------------------
# persist_results()
# ---------------------------------------------------------------------------
def test_persist_results_success_path():
    cur = FakeCursor(fetchone_queue=[("proc-1",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    results = {"transcription": TranscriptionResult(rows=[_segment(0)])}

    db.persist_results(results, {})

    # upsert marked success with the resolved table name
    upsert_sql, upsert_params = cur.executed[0]
    assert "INSERT INTO video_processing" in upsert_sql
    assert upsert_params == (REQUEST_ID, "transcription", "success", "transcript_segments", None)
    # rows replaced and the success write committed inside a transaction
    assert cur.executemany_calls
    assert cur.connection.commits == 1


def test_persist_results_error_path_marks_error_outside_transaction():
    cur = FakeCursor(fetchone_queue=[("proc-err",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.persist_results({}, {"transcription": "boom"})

    _, params = cur.executed[0]
    assert params == (REQUEST_ID, "transcription", "error", None, "boom")
    # error branch is not wrapped in transaction() -> no explicit commit
    assert cur.connection.commits == 0
    assert cur.executemany_calls == []


def test_persist_results_mixed_success_and_error():
    cur = FakeCursor(fetchone_queue=[("proc-ok",), ("proc-err",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    results = {"transcription": TranscriptionResult(rows=[_segment(0)])}
    errors = {"ocr": "failed"}

    db.persist_results(results, errors)

    statuses = [params[2] for _, params in cur.executed if "video_processing" in _]
    assert "success" in statuses
    assert "error" in statuses
    assert cur.connection.commits == 1  # only the success result commits


# ---------------------------------------------------------------------------
# persist_quality_frames()
# ---------------------------------------------------------------------------
def test_persist_quality_frames_deletes_then_inserts():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    flags = [
        QualityFlag(
            index=0,
            timestamp=0.0,
            reasons=("blur", "contrast"),
            scores={"sharpness": 1.0, "contrast": 2.0},
        ),
        QualityFlag(
            index=5,
            timestamp=0.5,
            reasons=("exposure",),
            scores={"mean_luma": 3.0},
        ),
    ]

    db.persist_quality_frames(flags)

    delete_sql, delete_params = cur.executed[0]
    assert delete_sql == "DELETE FROM quality_frames WHERE request_id = %s;"
    assert delete_params == (REQUEST_ID,)

    assert len(cur.executemany_calls) == 1
    insert_sql, values = cur.executemany_calls[0]
    assert "INSERT INTO quality_frames" in insert_sql
    # the INSERT is a multi-line triple-quoted string in supabase.py, so check
    # columns individually rather than asserting one exact formatted substring
    for column in (
        "request_id", "frame_id", "timestamp_ms", "reasons",
        "sharpness", "crushed_frac", "blown_frac", "mean_luma",
        "contrast", "grain", "blockiness", "temporal_delta",
    ):
        assert column in insert_sql
    assert insert_sql.count("%s") == 12
    # sharpness/contrast set, everything else None -> SQL NULL
    assert values[0] == (
        REQUEST_ID, "q_000000", 0, ["blur", "contrast"],
        1.0, None, None, None, 2.0, None, None, None,
    )
    # timestamp 0.5s -> 500ms; only mean_luma set
    assert values[1] == (
        REQUEST_ID, "q_000005", 500, ["exposure"],
        None, None, None, 3.0, None, None, None, None,
    )
    # commits inside the same transaction as the delete
    assert cur.connection.commits == 1


def test_persist_quality_frames_empty_deletes_only():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    db.persist_quality_frames([])

    assert cur.executed[0][0] == "DELETE FROM quality_frames WHERE request_id = %s;"
    assert cur.executed[0][1] == (REQUEST_ID,)
    assert cur.executemany_calls == []
    # the delete still commits on a retry that flags nothing this time
    assert cur.connection.commits == 1


# ---------------------------------------------------------------------------
# persist_video_metadata()
# ---------------------------------------------------------------------------
def test_persist_video_metadata_normal_case():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    metadata = VideoMetadata(duration_s=12.5, fps=30.0, width=1920, height=1080, size_bytes=999)
    scene_result = SceneProbeResult(
        shots=[],
        pacing={"shot_count": 5, "cuts_per_second": 0.4, "avg_shot_s": 2.5, "min_shot_s": 1.0, "max_shot_s": 4.0},
        fades=[],
        dynamism="moderate",
    )

    db.persist_video_metadata(metadata, scene_result)

    sql, params = cur.executed[0]
    assert "ON CONFLICT (request_id)" in sql
    assert params == (
        REQUEST_ID,
        12500,
        "16:9",
        "1920x1080",
        5,
        0.4,
        2.5,
        1.0,
        4.0,
        "moderate",
        30.0,
    )
    assert cur.connection.commits == 1


def test_persist_video_metadata_scene_result_none():
    cur = FakeCursor()
    db = Supabase(cur=cur, request_id=REQUEST_ID)
    metadata = VideoMetadata(duration_s=12.5, fps=30.0, width=1920, height=1080, size_bytes=999)

    db.persist_video_metadata(metadata, None)

    _, params = cur.executed[0]
    assert params[4:] == (None, None, None, None, None, None, 30.0)


@pytest.mark.parametrize(
    "width, height, expected",
    [
        (1920, 1080, "16:9"),
        (1280, 720, "16:9"),
        (1080, 1920, "9:16"),
        (0, 1080, "unknown"),
        (1920, 0, "unknown"),
    ],
)
def test_aspect_ratio_helper(width, height, expected):
    assert _aspect_ratio(width, height) == expected
