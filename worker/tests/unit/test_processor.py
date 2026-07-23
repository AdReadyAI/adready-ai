"""Unit tests for the worker processor orchestration (app/processor.py)."""

import os
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.unit

# config.settings reads DATABASE_URL at import time; processor never connects in unit tests.
os.environ.setdefault("DATABASE_URL", "mock_db")
os.environ.setdefault("OPENROUTER_API_KEY", "mock_key")

import app.processor as processor  # noqa: E402
from app.errors import PermanentError, TransientError  # noqa: E402
from app.schemas import JobPayload  # noqa: E402
from analyzer.output_models import (  # noqa: E402
    OcrResult,
    TranscriptionResult,
    TranscriptSegment,
)


VALID_PAYLOAD = {
    "request_id": "11111111-1111-1111-1111-111111111111",
    "ad_creative_id": "22222222-2222-2222-2222-222222222222",
    "ocr_run_id": "33333333-3333-3333-3333-333333333333",
    "requested_analyses": ["ocr"],
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
    assert str(parsed.request_id) == VALID_PAYLOAD["request_id"]
    assert parsed.bucket == "videos"


def test_parse_payload_invalid_raises_value_error():
    # pydantic ValidationError subclasses ValueError.
    with pytest.raises(ValueError):
        processor._parse_payload(1, {"request_id": "only-this"})


def test_process_message_rejects_unsupported_analysis_before_preprocessing(monkeypatch):
    """An invalid trusted request must not reach media or provider work."""

    class UnexpectedPreprocessor:
        def __init__(self, *args, **kwargs):
            raise AssertionError("preprocessing must not start")

    monkeypatch.setattr(processor, "VideoPreprocessor", UnexpectedPreprocessor)
    payload = {**VALID_PAYLOAD, "requested_analyses": ["transcription"]}

    with pytest.raises(ValueError, match="requested_analyses"):
        processor.process_message(cur=object(), msg_id=1, payload=payload)


def test_process_message_skips_completed_ocr_run(monkeypatch):
    """Queue redelivery must not repeat completed Media Processing."""

    class CompletedRunStore:
        def __init__(self, cur, request_id):
            pass

        def create_or_resume_ocr_run(self, payload):
            return "completed"

    class UnexpectedPreprocessor:
        def __init__(self, *args, **kwargs):
            raise AssertionError("completed OCR Runs must not be processed again")

    monkeypatch.setattr(processor, "Supabase", CompletedRunStore)
    monkeypatch.setattr(processor, "VideoPreprocessor", UnexpectedPreprocessor)

    processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)


def test_process_message_records_overlong_ad_creative_before_analysis(monkeypatch):
    """Unsupported media must fail durably before any provider can be invoked."""

    recorder = {}

    class RunStore:
        def __init__(self, cur, request_id):
            pass

        def create_or_resume_ocr_run(self, payload):
            return "processing"

        def fail_ocr_run(self, ocr_run_id, error):
            recorder["failure"] = (str(ocr_run_id), error)

    class OverlongPreprocessor:
        def __init__(self, payload, work_dir):
            pass

        def prepare(self):
            return SimpleNamespace(
                duration_s=60.001,
                fps=30.0,
                width=1920,
                height=1080,
            )

    class UnexpectedAnalyzer:
        def __init__(self, artifacts):
            raise AssertionError("unsupported media must not reach analysis")

    monkeypatch.setattr(processor, "Supabase", RunStore)
    monkeypatch.setattr(processor, "VideoPreprocessor", OverlongPreprocessor)
    monkeypatch.setattr(processor, "VideoAnalyzer", UnexpectedAnalyzer)

    with pytest.raises(PermanentError, match="60 seconds"):
        processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)

    assert recorder["failure"][0] == VALID_PAYLOAD["ocr_run_id"]
    assert "60 seconds" in recorder["failure"][1]


@pytest.mark.parametrize(
    ("artifacts", "expected_error"),
    [
        (
            SimpleNamespace(
                duration_s=float("nan"),
                fps=30.0,
                width=1920,
                height=1080,
            ),
            "duration",
        ),
        (
            SimpleNamespace(
                duration_s=30.0,
                fps=0.0,
                width=1920,
                height=1080,
            ),
            "timestamps",
        ),
        (
            SimpleNamespace(
                duration_s=30.0,
                fps=30.0,
                width=0,
                height=1080,
            ),
            "dimensions",
        ),
    ],
)
def test_process_message_records_invalid_media_before_analysis(
    monkeypatch,
    artifacts,
    expected_error,
):
    """Invalid timing and dimensions must fail through the worker boundary."""

    recorder = {}

    class RunStore:
        def __init__(self, cur, request_id):
            pass

        def create_or_resume_ocr_run(self, payload):
            return "processing"

        def fail_ocr_run(self, ocr_run_id, error):
            recorder["error"] = error

    class InvalidMediaPreprocessor:
        def __init__(self, payload, work_dir):
            pass

        def prepare(self):
            return artifacts

    class UnexpectedAnalyzer:
        def __init__(self, prepared_artifacts):
            raise AssertionError("invalid media must not reach analysis")

    monkeypatch.setattr(processor, "Supabase", RunStore)
    monkeypatch.setattr(processor, "VideoPreprocessor", InvalidMediaPreprocessor)
    monkeypatch.setattr(processor, "VideoAnalyzer", UnexpectedAnalyzer)

    with pytest.raises(PermanentError, match=expected_error):
        processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)

    assert expected_error in recorder["error"]


def test_process_message_records_undecodable_media_without_source_details(monkeypatch):
    """Decode failures must be durable without persisting sensitive locations."""

    recorder = {}

    class RunStore:
        def __init__(self, cur, request_id):
            pass

        def create_or_resume_ocr_run(self, payload):
            return "processing"

        def fail_ocr_run(self, ocr_run_id, error):
            recorder["error"] = error

    class UndecodablePreprocessor:
        def __init__(self, payload, work_dir):
            pass

        def prepare(self):
            raise PermanentError(
                "Could not decode https://signed.example/video?secret=value"
            )

    monkeypatch.setattr(processor, "Supabase", RunStore)
    monkeypatch.setattr(processor, "VideoPreprocessor", UndecodablePreprocessor)

    with pytest.raises(PermanentError, match="Could not decode"):
        processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)

    assert recorder["error"] == "Media Processing failed: PermanentError"


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
    results, errors = processor._run_analysis(
        FakeDB(),
        FakeAnalyzer(tasks),
        requested_analyses={"transcription", "context"},
    )

    assert results == {"transcription": "RESULT", "context": "CTX"}
    assert errors == {}


def test_run_analysis_skips_completed_tasks():
    tasks = {"transcription": lambda: "RESULT", "context": lambda: "CTX"}
    db = FakeDB(done={"transcription"})

    results, errors = processor._run_analysis(
        db,
        FakeAnalyzer(tasks),
        requested_analyses={"transcription", "context"},
    )

    assert "transcription" not in results
    assert results == {"context": "CTX"}
    assert errors == {}


def test_run_analysis_routes_exceptions_to_errors():
    def boom():
        raise RuntimeError("kaboom")

    tasks = {"transcription": lambda: "OK", "ocr": boom}
    results, errors = processor._run_analysis(
        FakeDB(),
        FakeAnalyzer(tasks),
        requested_analyses={"transcription", "ocr"},
    )

    assert results == {"transcription": "OK"}
    assert set(errors) == {"ocr"}
    assert "kaboom" in errors["ocr"]


def test_run_analysis_skips_none_results():
    # Stub tasks return None; they must not be recorded as results (would break persist).
    tasks = {"transcription": lambda: None, "context": lambda: "CTX"}
    results, errors = processor._run_analysis(
        FakeDB(),
        FakeAnalyzer(tasks),
        requested_analyses={"transcription", "context"},
    )

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
        def __init__(self, payload, work_dir):
            if recorder is not None:
                recorder["preprocessed_ad_creative_id"] = payload.ad_creative_id

        def prepare(self):
            return SimpleNamespace(
                duration_s=30.0,
                fps=30.0,
                width=1920,
                height=1080,
            )

    class FakeVideoAnalyzer:
        def __init__(self, artifact):
            pass

        def analysis_tasks(self):
            return tasks

    class FakeSupabase:
        def __init__(self, cur, request_id):
            if recorder is not None:
                recorder["request_id"] = request_id

        def create_or_resume_ocr_run(self, payload):
            if recorder is not None:
                recorder["ocr_run_id"] = payload.ocr_run_id
            return "processing"

        def fail_ocr_run(self, ocr_run_id, error):
            if recorder is not None:
                recorder["failure"] = (ocr_run_id, error)

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
    tasks = {"ocr": lambda: OcrResult(rows=[])}
    _wire_process_message(monkeypatch, tasks, recorder=recorder)

    processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)

    assert str(recorder["request_id"]) == VALID_PAYLOAD["request_id"]
    assert (
        str(recorder["preprocessed_ad_creative_id"])
        == VALID_PAYLOAD["ad_creative_id"]
    )
    results, errors = recorder["persisted"]
    assert "ocr" in results
    assert errors == {}


def test_process_message_runs_only_requested_ocr_analysis(monkeypatch):
    calls = []
    tasks = {
        "ocr": lambda: calls.append("ocr"),
        "transcription": lambda: calls.append("transcription"),
    }
    _wire_process_message(monkeypatch, tasks)

    processor.process_message(cur=object(), msg_id=1, payload=VALID_PAYLOAD)

    assert calls == ["ocr"]


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
