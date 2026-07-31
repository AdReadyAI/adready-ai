"""Unit tests for the worker processor orchestration (app/processor.py)."""

import pytest

pytestmark = pytest.mark.unit

import app.processor as processor  # noqa: E402
from app.errors import PermanentError, TransientError  # noqa: E402
from app.schemas import JobPayload  # noqa: E402
from analyzer.output_models import TranscriptionResult, TranscriptSegment  # noqa: E402
from analyzer.types import VideoMetadata  # noqa: E402


VALID_PAYLOAD = {
    "request_id": "req-1",
    "bucket": "videos",
    "video_path": "path/to/video.mp4",
    "product_image_paths": ["path/to/imgs/product_1.png"],
    "logo_paths": ["path/to/imgs/logo_1.png"],
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


def test_parse_payload_allows_empty_logo_paths():
    # A request with no logos is valid; only product_image_paths is guaranteed non-empty.
    payload = {**VALID_PAYLOAD, "logo_paths": []}
    parsed = processor._parse_payload(1, payload)
    assert parsed.logo_paths == []


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


def test_ocr_wrapper_consumes_owned_completion_without_affecting_other_tasks():
    """Atomic OCR completion must not enter generic task-result persistence."""

    class Analyzer:
        """Expose one OCR task and one unrelated analysis task."""

        def analysis_tasks(self):
            return {
                "ocr": lambda: "fixed-rate-analysis",
                "transcription": lambda: "transcript-result",
            }

    class Lifecycle:
        """Return an OCR-owned completion after consuming fixed-rate analysis."""

        def execute(self, run_ocr, metadata):
            assert run_ocr() == "fixed-rate-analysis"
            return "ocr-completion"

    wrapped = processor._OcrLifecycleAnalyzer(
        Analyzer(),
        Lifecycle(),
        VideoMetadata(1.0, 20.0, 200, 100, 1_000),
    )
    tasks = wrapped.analysis_tasks()

    assert tasks["ocr"]() is None
    assert tasks["transcription"]() == "transcript-result"


# ---------------------------------------------------------------------------
# process_message()
# ---------------------------------------------------------------------------
def _wire_process_message(monkeypatch, tasks, done=None, recorder=None):
    class FakePreprocessor:
        def __init__(self, request_id, work_dir):
            pass

        def prepare(self):
            # The production artifact always carries metadata used by the
            # OCR-local lifecycle before hosted analysis begins.
            metadata = VideoMetadata(
                duration_s=10.0,
                fps=30.0,
                width=1920,
                height=1080,
                size_bytes=1_000,
            )
            return type("PreparedArtifacts", (), {"video_metadata": metadata})()

    class FakeVideoAnalyzer:
        def __init__(self, artifact, *, ocr_adapter=None):
            self.ocr_adapter = ocr_adapter

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

    class FakeOcrRunLifecycle:
        """Keep legacy processor tests focused on their existing behavior."""

        def __init__(
            self,
            cur,
            request_id,
            source_bucket,
            source_path,
            completion_coordinator,
        ):
            """Accept the optional OCR-owned completion dependency."""

        def execute(self, run_ocr, metadata):
            """Delegate through the OCR boundary without changing task results."""
            return run_ocr()

    monkeypatch.setattr(processor, "VideoPreprocessor", FakePreprocessor)
    monkeypatch.setattr(processor, "VideoAnalyzer", FakeVideoAnalyzer)
    monkeypatch.setattr(processor, "Supabase", FakeSupabase)
    monkeypatch.setattr(processor, "OcrRunLifecycle", FakeOcrRunLifecycle)


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


def test_process_message_wraps_only_the_registered_ocr_task(monkeypatch):
    """Media Processing adds durable lifecycle only around the OCR analysis."""
    execution_events = []
    expected_ocr_adapter = object()
    expected_completion_coordinator = object()
    metadata = VideoMetadata(
        duration_s=10.0,
        fps=30.0,
        width=1920,
        height=1080,
        size_bytes=1_000,
    )

    class FakePreprocessor:
        """Return prepared media without exercising shared preprocessing."""

        def __init__(self, payload, work_dir):
            self.payload = payload

        def prepare(self):
            """Expose only the metadata required by the OCR lifecycle."""
            return type("PreparedArtifacts", (), {"video_metadata": metadata})()

    class FakeVideoAnalyzer:
        """Expose one OCR task and one unaffected non-OCR task."""

        def __init__(self, artifact, *, ocr_adapter):
            self.artifact = artifact
            assert ocr_adapter is expected_ocr_adapter
            execution_events.append("ocr-adapter-configured")

        def analysis_tasks(self):
            """Return the worker-owned analysis registry."""
            return {
                "ocr": lambda: execution_events.append("ocr-analysis"),
                "transcription": lambda: execution_events.append("transcription"),
            }

    class FakeSupabase:
        """Provide the existing generalized result-persistence boundary."""

        def __init__(self, cur, request_id):
            self.request_id = request_id

        def completed_analyzers(self):
            """Report that both registered analyses still require execution."""
            return set()

        def persist_results(self, results, errors):
            """Accept the unchanged processor result envelope."""

    class FakeOcrRunLifecycle:
        """Expose whether the processor routes OCR through its owned slice."""

        def __init__(
            self,
            cur,
            request_id,
            source_bucket,
            source_path,
            completion_coordinator,
        ):
            assert completion_coordinator is expected_completion_coordinator
            execution_events.append("ocr-completion-configured")
            execution_events.append("ocr-lifecycle-created")

        def execute(self, run_ocr, prepared_metadata):
            """Record the OCR boundary before delegating to analysis."""
            assert prepared_metadata is metadata
            execution_events.append("ocr-lifecycle")
            return run_ocr()

    monkeypatch.setattr(processor, "VideoPreprocessor", FakePreprocessor)
    monkeypatch.setattr(processor, "VideoAnalyzer", FakeVideoAnalyzer)
    monkeypatch.setattr(processor, "Supabase", FakeSupabase)
    monkeypatch.setattr(
        processor,
        "_build_ocr_adapter",
        lambda: expected_ocr_adapter,
    )
    monkeypatch.setattr(
        processor,
        "_build_ocr_completion_coordinator",
        lambda: expected_completion_coordinator,
    )
    monkeypatch.setattr(
        processor,
        "OcrRunLifecycle",
        FakeOcrRunLifecycle,
        raising=False,
    )

    processor.process_message(cur=object(), msg_id=9, payload=VALID_PAYLOAD)

    assert set(execution_events) == {
        "ocr-adapter-configured",
        "ocr-completion-configured",
        "ocr-lifecycle-created",
        "ocr-lifecycle",
        "ocr-analysis",
        "transcription",
    }
