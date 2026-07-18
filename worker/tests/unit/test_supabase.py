"""Unit tests for the Supabase persistence layer (app/supabase.py)."""

import pytest

pytestmark = pytest.mark.unit

from app.supabase import Supabase
from analyzer.output_models import (
    FrameTextItem,
    FrameTextResult,
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
# completed_analyzers()
# ---------------------------------------------------------------------------
def test_completed_analyzers_returns_successful_task_names():
    cur = FakeCursor(fetchall_result=[("transcription",), ("frame_text",)])
    db = Supabase(cur=cur, request_id=REQUEST_ID)

    done = db.completed_analyzers()

    assert done == {"transcription", "frame_text"}
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

    db._replace_rows("frame_text_items", "proc-1", [FrameTextItem()])

    insert_sql, values = cur.executemany_calls[0]
    assert "INSERT INTO frame_text_items (processing_id) VALUES (%s);" == insert_sql
    assert values == [("proc-1",)]


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
    errors = {"frame_text": "failed"}

    db.persist_results(results, errors)

    statuses = [params[2] for _, params in cur.executed if "video_processing" in _]
    assert "success" in statuses
    assert "error" in statuses
    assert cur.connection.commits == 1  # only the success result commits
