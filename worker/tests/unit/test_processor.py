"""Unit tests for the worker processor orchestration (app/processor.py)."""

from unittest.mock import MagicMock
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.unit

import app.processor as processor  # noqa: E402
from app.errors import PermanentError, TransientError  # noqa: E402
from app.schemas import JobPayload  # noqa: E402
from analyzer.frame_sampling.probes.quality import QualityFlag, QualityProbeResult  # noqa: E402
from analyzer.output_models import TranscriptionResult, TranscriptSegment  # noqa: E402
from analyzer.ocr.completion import OcrCompletionCoordinator  # noqa: E402
from analyzer.ocr.roboflow import RoboflowEasyOcrAdapter  # noqa: E402
from analyzer.ocr.routing import OcrCandidateMode  # noqa: E402
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
        self.marked_processing = []

    def completed_analyzers(self):
        return self._done

    def mark_processing(self, task_name):
        self.marked_processing.append(task_name)


class FakeProductContextDB:
    """Record the Product Context orchestration without touching Postgres."""

    def __init__(self, url):
        self.url = url
        self.raw_text = None

    def product_url_requiring_context(self):
        return self.url

    def upsert_product_context(self, raw_text, reference_asset_urls):
        self.raw_text = raw_text


def test_populate_product_context_extracts_and_persists_page_text():
    db = FakeProductContextDB("https://example.com/product")
    extractor = MagicMock()
    extractor.extract.return_value = SimpleNamespace(
        raw_text="Product facts",
        reference_asset_urls=("https://example.com/product.jpg",),
    )

    processor._populate_product_context(db, extractor=extractor)

    assert db.raw_text == "Product facts"


def test_populate_product_context_skips_request_without_pending_url():
    db = FakeProductContextDB(None)
    extractor = MagicMock()

    processor._populate_product_context(db, extractor=extractor)

    extractor.extract.assert_not_called()
    assert db.raw_text is None


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


def test_run_analysis_marks_pending_tasks_as_processing():
    tasks = {"transcription": lambda: "RESULT", "context": lambda: "CTX"}
    db = FakeDB(done={"transcription"})

    processor._run_analysis(db, FakeAnalyzer(tasks))

    # already-completed tasks are not re-marked; only pending ones are.
    assert db.marked_processing == ["context"]


def test_run_analysis_marks_all_tasks_processing_before_any_task_runs():
    # Regression guard: mark_processing must be called for every pending task,
    # from the calling thread, before the executor starts running task functions.
    # The Supabase cursor is not thread-safe, so marking must happen serially
    # up front rather than per-task inside a worker thread.
    events = []

    class OrderTrackingDB(FakeDB):
        def mark_processing(self, task_name):
            events.append(("mark", task_name))

    def make_task(name):
        def task():
            events.append(("run", name))
            return name
        return task

    tasks = {name: make_task(name) for name in ("transcription", "ocr", "context")}
    processor._run_analysis(OrderTrackingDB(), FakeAnalyzer(tasks))

    marks = [e for e in events if e[0] == "mark"]
    runs = [e for e in events if e[0] == "run"]
    assert {name for _, name in marks} == set(tasks)
    # every mark happens before every run, regardless of thread scheduling order
    last_mark_index = max(events.index(m) for m in marks)
    first_run_index = min(events.index(r) for r in runs)
    assert last_mark_index < first_run_index


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
    """Atomic OCR completion must not enter generic result persistence."""

    class Analyzer:
        """Expose one OCR task and one unrelated analysis task."""

        def analysis_tasks(self):
            return {
                "ocr": lambda: "fixed-rate-analysis",
                "transcription": lambda: "transcript-result",
            }

    class Lifecycle:
        """Consume OCR analysis through its owned completion boundary."""

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
def _wire_process_message(
    monkeypatch,
    tasks,
    done=None,
    recorder=None,
    probe_results=None,
    fail_quality_persist=False,
    fail_video_metadata_persist=False,
):
    class FakePreprocessor:
        def __init__(self, request_id, work_dir):
            pass

        def prepare(self):
            # A bare object() no longer satisfies process_message(), which now
            # reads artifact.probe_results — mirror the real Artifacts contract
            # just enough for that access to work.
            return SimpleNamespace(
                probe_results=probe_results or {}, video_metadata="VIDEO_METADATA"
            )

    class FakeVideoAnalyzer:
        def __init__(
            self,
            artifact,
            *,
            ocr_adapter=None,
            ocr_candidate_mode=None,
        ):
            if recorder is not None:
                recorder["ocr_adapter"] = ocr_adapter
                recorder["ocr_candidate_mode"] = ocr_candidate_mode

        def analysis_tasks(self):
            return tasks

    class FakeSupabase:
        def __init__(self, cur, request_id):
            if recorder is not None:
                recorder["request_id"] = request_id

        def completed_analyzers(self):
            return done or set()

        def mark_processing(self, task_name):
            pass
        def product_url_requiring_context(self):
            return None

        def upsert_product_context(self, raw_text, reference_asset_urls):
            if recorder is not None:
                recorder["product_context"] = raw_text

        def persist_results(self, results, errors):
            if recorder is not None:
                recorder["persisted"] = (results, errors)

        def persist_quality_frames(self, flags):
            if fail_quality_persist:
                raise RuntimeError("db down")
            if recorder is not None:
                recorder["quality_flags"] = flags

        def persist_video_metadata(self, metadata, scene_result):
            if fail_video_metadata_persist:
                raise RuntimeError("db down")
            if recorder is not None:
                recorder["video_metadata"] = (metadata, scene_result)

    class FakeOcrRunLifecycle:
        """Keep orchestration tests focused on the processor boundary."""

        def __init__(
            self,
            cur,
            request_id,
            source_bucket,
            source_path,
            completion_coordinator,
        ):
            if recorder is not None:
                recorder["completion_coordinator"] = completion_coordinator

        def execute(self, run_ocr, metadata):
            """Delegate through the OCR boundary without changing results."""
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
        "product_detection": lambda: None,
        "logo_detection": lambda: None,
        "context": lambda: None,
    }
    _wire_process_message(monkeypatch, tasks, recorder=recorder)

    processor.process_message(cur=object(), msg_id=2, payload=VALID_PAYLOAD)

    results, errors = recorder["persisted"]
    assert results == {}
    assert errors == {}
def test_process_message_persists_quality_frames(monkeypatch):
    recorder = {}
    flag = QualityFlag(index=0, timestamp=0.0, reasons=("blur",), scores={})
    probe_results = {"quality": QualityProbeResult(flags=[flag])}
    tasks = {"transcription": lambda: None}
    _wire_process_message(
        monkeypatch, tasks, recorder=recorder, probe_results=probe_results
    )

    processor.process_message(cur=object(), msg_id=3, payload=VALID_PAYLOAD)

    assert recorder["quality_flags"] == [flag]


def test_process_message_skips_quality_persist_when_probe_absent(monkeypatch):
    # No "quality" key at all (e.g. the probe errored during sampling and got
    # excluded from probe_results) -> persist_quality_frames must not be called.
    recorder = {}
    tasks = {"transcription": lambda: None}
    _wire_process_message(monkeypatch, tasks, recorder=recorder)

    processor.process_message(cur=object(), msg_id=4, payload=VALID_PAYLOAD)

    assert "quality_flags" not in recorder


def test_process_message_quality_persist_failure_does_not_abort_job(monkeypatch):
    # A DB error persisting quality evidence must not prevent the paid
    # analyzer calls from running or their results from being persisted.
    recorder = {}
    flag = QualityFlag(index=0, timestamp=0.0, reasons=("blur",), scores={})
    probe_results = {"quality": QualityProbeResult(flags=[flag])}
    segment = TranscriptSegment(segment_id="tr_000", start_ms=0, end_ms=1, text="hi")
    tasks = {"transcription": lambda: TranscriptionResult(rows=[segment])}
    _wire_process_message(
        monkeypatch,
        tasks,
        recorder=recorder,
        probe_results=probe_results,
        fail_quality_persist=True,
    )

    processor.process_message(cur=object(), msg_id=5, payload=VALID_PAYLOAD)

    assert "quality_flags" not in recorder  # the failing call never recorded anything
    results, errors = recorder["persisted"]
    assert "transcription" in results  # but analysis still ran and persisted
    assert errors == {}


def test_process_message_persists_video_metadata(monkeypatch):
    recorder = {}
    scene_result = object()
    probe_results = {"scene": scene_result}
    tasks = {"transcription": lambda: None}
    _wire_process_message(
        monkeypatch, tasks, recorder=recorder, probe_results=probe_results
    )

    processor.process_message(cur=object(), msg_id=6, payload=VALID_PAYLOAD)

    metadata, recorded_scene_result = recorder["video_metadata"]
    assert metadata == "VIDEO_METADATA"
    assert recorded_scene_result is scene_result


def test_process_message_video_metadata_persist_failure_does_not_abort_job(monkeypatch):
    # A DB error persisting video metadata must not prevent the paid analyzer
    # calls from running or their results from being persisted.
    recorder = {}
    segment = TranscriptSegment(segment_id="tr_000", start_ms=0, end_ms=1, text="hi")
    tasks = {"transcription": lambda: TranscriptionResult(rows=[segment])}
    _wire_process_message(
        monkeypatch,
        tasks,
        recorder=recorder,
        fail_video_metadata_persist=True,
    )

    processor.process_message(cur=object(), msg_id=7, payload=VALID_PAYLOAD)

    assert "video_metadata" not in recorder  # the failing call never recorded anything
    results, errors = recorder["persisted"]
    assert "transcription" in results  # but analysis still ran and persisted
    assert errors == {}


def test_process_message_builds_hosted_ocr_adapter_from_environment(
    monkeypatch,
):
    """Complete OCR configuration activates recognition at composition."""
    monkeypatch.setenv("ROBOFLOW_API_KEY", "private-api-key")
    monkeypatch.setenv("ROBOFLOW_WORKSPACE_ID", "workspace-id")
    monkeypatch.setenv("ROBOFLOW_OCR_WORKFLOW_ID", "workflow-id")
    monkeypatch.setenv("ROBOFLOW_OCR_TIMEOUT_SECONDS", "12.5")
    recorder = {}
    _wire_process_message(
        monkeypatch,
        {"ocr": lambda: None},
        recorder=recorder,
    )
    monkeypatch.setattr(
        processor,
        "_build_ocr_completion_coordinator",
        lambda configuration=None: object(),
    )

    processor.process_message(cur=object(), msg_id=8, payload=VALID_PAYLOAD)

    assert isinstance(recorder["ocr_adapter"], RoboflowEasyOcrAdapter)


def test_process_message_builds_durable_ocr_completion(monkeypatch):
    """Worker composition supplies durable frame storage to OCR lifecycle."""
    recorder = {}
    _wire_process_message(
        monkeypatch,
        {"ocr": lambda: None},
        recorder=recorder,
    )
    monkeypatch.setattr(processor, "_build_ocr_adapter", lambda: None)

    processor.process_message(cur=object(), msg_id=9, payload=VALID_PAYLOAD)

    assert isinstance(
        recorder["completion_coordinator"],
        OcrCompletionCoordinator,
    )


def test_process_message_uses_one_ocr_runtime_configuration(monkeypatch):
    """Candidate routing and durable storage share one validated activation."""
    monkeypatch.setenv("OCR_CANDIDATE_MODE", "cascade_shadow")
    recorder = {}
    received_configuration = []
    _wire_process_message(
        monkeypatch,
        {"ocr": lambda: None},
        recorder=recorder,
    )
    monkeypatch.setattr(processor, "_build_ocr_adapter", lambda: None)

    def build_completion(configuration=None):
        """Capture the configuration supplied to durable artifact storage."""
        received_configuration.append(configuration)
        return object()

    monkeypatch.setattr(
        processor,
        "_build_ocr_completion_coordinator",
        build_completion,
    )

    processor.process_message(cur=object(), msg_id=10, payload=VALID_PAYLOAD)

    assert recorder["ocr_candidate_mode"] is OcrCandidateMode.CASCADE_SHADOW
    assert received_configuration[0].candidate_mode is (
        OcrCandidateMode.CASCADE_SHADOW
    )


def test_process_message_wraps_only_the_registered_ocr_task(monkeypatch):
    """Media Processing adds durable lifecycle only around OCR analysis."""
    execution_events = []
    expected_ocr_adapter = object()
    expected_completion_coordinator = object()
    metadata = VideoMetadata(10.0, 30.0, 1920, 1080, 1_000)

    class FakePreprocessor:
        """Return prepared media without shared preprocessing."""

        def __init__(self, payload, work_dir):
            self.payload = payload

        def prepare(self):
            return SimpleNamespace(
                video_metadata=metadata,
                probe_results={},
            )

    class FakeVideoAnalyzer:
        """Expose one OCR task and one unaffected non-OCR task."""

        def __init__(
            self,
            artifact,
            *,
            ocr_adapter,
            ocr_candidate_mode=None,
        ):
            assert ocr_adapter is expected_ocr_adapter
            assert ocr_candidate_mode is OcrCandidateMode.FIXED_4FPS
            execution_events.append("ocr-adapter-configured")

        def analysis_tasks(self):
            return {
                "ocr": lambda: execution_events.append("ocr-analysis"),
                "transcription": lambda: execution_events.append(
                    "transcription"
                ),
            }

    class FakeSupabase:
        """Provide main's generic result and metadata boundaries."""

        def __init__(self, cur, request_id):
            self.request_id = request_id

        def product_url_requiring_context(self):
            """Model a request whose product context is already complete."""
            return None

        def completed_analyzers(self):
            return set()

        def persist_quality_frames(self, flags):
            """Accept main's optional quality persistence."""

        def persist_video_metadata(self, metadata, scene_result):
            """Accept main's video metadata persistence."""

        def persist_results(self, results, errors):
            """Accept the unchanged generic result envelope."""

    class FakeOcrRunLifecycle:
        """Expose whether only OCR crosses its owned lifecycle."""

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
        lambda configuration=None: expected_completion_coordinator,
    )
    monkeypatch.setattr(processor, "OcrRunLifecycle", FakeOcrRunLifecycle)

    processor.process_message(cur=object(), msg_id=11, payload=VALID_PAYLOAD)

    assert set(execution_events) == {
        "ocr-adapter-configured",
        "ocr-completion-configured",
        "ocr-lifecycle-created",
        "ocr-lifecycle",
        "ocr-analysis",
        "transcription",
    }
