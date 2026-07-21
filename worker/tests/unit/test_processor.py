"""Unit tests for the worker processor orchestration (app/processor.py)."""

import os

import pytest

pytestmark = pytest.mark.unit

# config.settings reads DATABASE_URL at import time; processor never connects in unit tests.
os.environ.setdefault("DATABASE_URL", "mock_db")
os.environ.setdefault("OPENROUTER_API_KEY", "mock_key")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

import app.processor as processor  # noqa: E402
from app.errors import PermanentError, TransientError  # noqa: E402
from app.schemas import JobPayload  # noqa: E402
from analyzer.output_models import TranscriptionResult, TranscriptSegment  # noqa: E402


VALID_PAYLOAD = {
    "request_id": "req-1",
    "bucket": "videos",
    "video_path": "path/to/video.mp4",
    "product_imgs_folder_path": "path/to/imgs",
}


# ---------------------------------------------------------------------------
# _parse_payload()
# ---------------------------------------------------------------------------
def test_parse_payload_valid():
    parsed = processor._parse_payload(1, VALID_PAYLOAD)
    assert isinstance(parsed, JobPayload)
    assert parsed.request_id == "req-1"
    assert parsed.bucket == "videos"


def test_parse_payload_invalid_raises_value_error():
    # pydantic ValidationError subclasses ValueError.
    with pytest.raises(ValueError):
        processor._parse_payload(1, {"request_id": "only-this"})


# ---------------------------------------------------------------------------
# Test doubles for _run_analysis
# ---------------------------------------------------------------------------
class FakeAnalyzer:
    def __init__(self, tasks):
        self._tasks = tasks

    def analysis_tasks(self):
        return self._tasks


class FakeDB:
    def __init__(self, done=None):
        self._done = done or set()

    def completed_analyzers(self):
        return self._done


# ---------------------------------------------------------------------------
# _run_analysis()
# ---------------------------------------------------------------------------
def test_run_analysis_collects_successful_results():
    tasks = {"transcription": lambda: "RESULT", "context": lambda: "CTX"}
    results, errors = processor._run_analysis(FakeDB(), FakeAnalyzer(tasks))

    assert results == {"transcription": "RESULT", "context": "CTX"}
    assert errors == {}


def test_run_analysis_skips_completed_tasks():
    tasks = {"transcription": lambda: "RESULT", "context": lambda: "CTX"}
    db = FakeDB(done={"transcription"})

    results, errors = processor._run_analysis(db, FakeAnalyzer(tasks))

    assert "transcription" not in results
    assert results == {"context": "CTX"}
    assert errors == {}


def test_run_analysis_routes_exceptions_to_errors():
    def boom():
        raise RuntimeError("kaboom")

    tasks = {"transcription": lambda: "OK", "ocr": boom}
    results, errors = processor._run_analysis(FakeDB(), FakeAnalyzer(tasks))

    assert results == {"transcription": "OK"}
    assert set(errors) == {"ocr"}
    assert "kaboom" in errors["ocr"]


def test_run_analysis_skips_none_results():
    # Stub tasks return None; they must not be recorded as results (would break persist).
    tasks = {"transcription": lambda: None, "context": lambda: "CTX"}
    results, errors = processor._run_analysis(FakeDB(), FakeAnalyzer(tasks))

    assert "transcription" not in results
    assert results == {"context": "CTX"}
    assert errors == {}


# ---------------------------------------------------------------------------
# _with_retry()
# ---------------------------------------------------------------------------
def test_with_retry_returns_on_first_success():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        return "ok"

    assert processor._with_retry(fn, attempts=3, base=0) == "ok"
    assert calls["n"] == 1


def test_with_retry_retries_transient_then_succeeds(monkeypatch):
    monkeypatch.setattr(processor.time, "sleep", lambda *_: None)
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise TransientError("temporary")
        return "ok"

    assert processor._with_retry(fn, attempts=3, base=0) == "ok"
    assert calls["n"] == 3


def test_with_retry_exhausts_attempts_and_raises(monkeypatch):
    monkeypatch.setattr(processor.time, "sleep", lambda *_: None)
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise TransientError("always")

    with pytest.raises(TransientError):
        processor._with_retry(fn, attempts=3, base=0)
    assert calls["n"] == 3


def test_with_retry_does_not_retry_permanent_error():
    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        raise PermanentError("nope")

    with pytest.raises(PermanentError):
        processor._with_retry(fn, attempts=3, base=0)
    assert calls["n"] == 1


# ---------------------------------------------------------------------------
# process_message()
# ---------------------------------------------------------------------------
def _wire_process_message(monkeypatch, tasks, done=None, recorder=None):
    class FakePreprocessor:
        def __init__(self, request_id, work_dir):
            pass

        def prepare(self):
            return object()

    class FakeVideoAnalyzer:
        def __init__(self, artifact):
            pass

        def analysis_tasks(self):
            return tasks

    class FakeSupabase:
        def __init__(self, cur, request_id):
            if recorder is not None:
                recorder["request_id"] = request_id

        def completed_analyzers(self):
            return done or set()

        def persist_results(self, results, errors):
            if recorder is not None:
                recorder["persisted"] = (results, errors)

    monkeypatch.setattr(processor, "VideoPreprocessor", FakePreprocessor)
    monkeypatch.setattr(processor, "VideoAnalyzer", FakeVideoAnalyzer)
    monkeypatch.setattr(processor, "Supabase", FakeSupabase)


def test_process_message_persists_results(monkeypatch):
    recorder = {}
    segment = TranscriptSegment(segment_id="tr_000", start_ms=0, end_ms=1, text="hi")
    tasks = {"transcription": lambda: TranscriptionResult(rows=[segment])}
    _wire_process_message(monkeypatch, tasks, recorder=recorder)

    processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)

    assert recorder["request_id"] == "req-1"
    results, errors = recorder["persisted"]
    assert "transcription" in results
    assert errors == {}


def test_process_message_raises_when_a_task_fails(monkeypatch):
    def boom():
        raise RuntimeError("analyzer failed")

    tasks = {"ocr": boom}
    _wire_process_message(monkeypatch, tasks)

    with pytest.raises(RuntimeError):
        processor.process_message(cur=object(), msg_id=7, payload=VALID_PAYLOAD)


def test_process_message_with_all_stub_tasks_does_not_crash(monkeypatch):
    # Mirrors the current branch state: every analyzer task is a stub returning None.
    recorder = {}
    tasks = {
        "transcription": lambda: None,
        "ocr": lambda: None,
        "object_detection": lambda: None,
        "context": lambda: None,
    }
    _wire_process_message(monkeypatch, tasks, recorder=recorder)

    processor.process_message(cur=object(), msg_id=2, payload=VALID_PAYLOAD)

    results, errors = recorder["persisted"]
    assert results == {}
    assert errors == {}

