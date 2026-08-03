"""Behavior tests for the OCR-owned durable run lifecycle."""

import pytest

pytestmark = pytest.mark.unit

from analyzer.types import VideoMetadata  # noqa: E402
from analyzer.ocr.completion import OcrCompletion  # noqa: E402
from analyzer.ocr.consolidation import OcrSegment  # noqa: E402
from analyzer.ocr.recognition import RawOcrReading  # noqa: E402
from analyzer.ocr.result import OcrResultSegment  # noqa: E402
from analyzer.frame_sampling.probes.text import TextSegment  # noqa: E402
from app.errors import PermanentError  # noqa: E402
from app.ocr_runs import OcrRunLifecycle  # noqa: E402


class CompletedRunCursor:
    """Database-boundary double returning one previously completed OCR Run."""

    def execute(self, sql, params=None):
        """Accept the lifecycle query without coupling the test to its SQL."""

    def fetchone(self):
        """Return the durable run identity and completed lifecycle state."""
        return ("ocr-run-1", "completed")


def test_completed_redelivery_does_not_repeat_ocr_analysis() -> None:
    """A completed OCR Run is reused without repeating billable OCR work."""
    ocr_called = False

    def run_ocr():
        """Make an accidental OCR invocation observable to the test."""
        nonlocal ocr_called
        ocr_called = True
        return object()

    lifecycle = OcrRunLifecycle(
        cur=CompletedRunCursor(),
        request_id="11111111-1111-1111-1111-111111111111",
        source_bucket="uploads",
        source_path="review/creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=12.0,
        fps=30.0,
        width=1920,
        height=1080,
        size_bytes=1_000,
    )

    result = lifecycle.execute(run_ocr, metadata)

    assert result is None
    assert ocr_called is False


def test_ocr_analysis_requires_durable_completion() -> None:
    """An OCR analysis cannot complete without immutable Result storage."""

    class MissingCompletionCursor:
        """Expose the durable failure caused by incomplete OCR wiring."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0
            self.error = None

        def execute(self, sql, params=None):
            """Model creation, timing provenance, then configuration failure."""
            self.write_count += 1
            if self.write_count == 3:
                self.status = "failed"
                self.error = params[0]

        def fetchone(self):
            """Return one processing OCR Run."""
            return ("ocr-run-2", self.status)

    cursor = MissingCompletionCursor()
    ocr_calls = 0

    def run_ocr():
        """Return analysis while exposing duplicate recognition attempts."""
        nonlocal ocr_calls
        ocr_calls += 1
        return object()

    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="22222222-2222-2222-2222-222222222222",
        source_bucket="uploads",
        source_path="review/new-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=8.0,
        fps=24.0,
        width=1080,
        height=1920,
        size_bytes=2_000,
    )

    with pytest.raises(
        RuntimeError,
        match="OCR completion is not configured",
    ):
        lifecycle.execute(run_ocr, metadata)

    assert ocr_calls == 1
    assert cursor.status == "failed"
    assert cursor.error == "RuntimeError: OCR completion is not configured"


def test_ocr_analysis_failure_marks_run_failed_and_reraises() -> None:
    """An operational OCR failure is durable and remains visible upstream."""

    class FailedRunCursor:
        """Database-boundary double exposing whether failure was persisted."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0

        def execute(self, sql, params=None):
            """Model a second lifecycle write as the failed transition."""
            self.write_count += 1
            if self.write_count > 1:
                self.status = "failed"

        def fetchone(self):
            """Return the current durable run identity and lifecycle state."""
            return ("ocr-run-4", self.status)

    def failed_ocr_analysis():
        """Represent an OCR failure that the processor must still receive."""
        raise RuntimeError("provider unavailable")

    cursor = FailedRunCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="44444444-4444-4444-4444-444444444444",
        source_bucket="uploads",
        source_path="review/failed-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=4.0,
        fps=25.0,
        width=1280,
        height=720,
        size_bytes=4_000,
    )

    with pytest.raises(RuntimeError, match="provider unavailable"):
        lifecycle.execute(failed_ocr_analysis, metadata)

    assert cursor.status == "failed"


def test_creative_over_sixty_seconds_fails_before_ocr_analysis() -> None:
    """OCR rejects an oversized Ad Creative before billable provider work."""

    class DurationFailureCursor:
        """Database-boundary double exposing the validation failure state."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0

        def execute(self, sql, params=None):
            """Model the lifecycle's second write as the failed transition."""
            self.write_count += 1
            if self.write_count > 1:
                self.status = "failed"

        def fetchone(self):
            """Return the current durable run identity and lifecycle state."""
            return ("ocr-run-5", self.status)

    ocr_called = False

    def run_ocr():
        """Expose any provider call made before duration validation."""
        nonlocal ocr_called
        ocr_called = True
        return object()

    cursor = DurationFailureCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="55555555-5555-5555-5555-555555555555",
        source_bucket="uploads",
        source_path="review/oversized-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=60.001,
        fps=30.0,
        width=1920,
        height=1080,
        size_bytes=5_000,
    )

    with pytest.raises(PermanentError, match="60 seconds"):
        lifecycle.execute(run_ocr, metadata)

    assert ocr_called is False
    assert cursor.status == "failed"


def test_cfr_fallback_is_recorded_before_ocr_analysis() -> None:
    """Current frame-index timing is made explicit before provider work."""

    class TimingRunCursor:
        """Database-boundary double exposing timing provenance to OCR."""

        def __init__(self):
            self.write_count = 0
            self.timing = None

        def execute(self, sql, params=None):
            """Capture the lifecycle write before OCR analysis."""
            self.write_count += 1
            if self.write_count == 2:
                self.timing = params[:2]

        def fetchone(self):
            """Return one newly processing OCR Run."""
            return ("ocr-run-6", "processing")

    cursor = TimingRunCursor()
    timing_seen_by_ocr = None

    def run_ocr():
        """Observe timing provenance at the OCR analysis boundary."""
        nonlocal timing_seen_by_ocr
        timing_seen_by_ocr = cursor.timing
        return None

    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="66666666-6666-6666-6666-666666666666",
        source_bucket="uploads",
        source_path="review/cfr-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=10.0,
        fps=29.97,
        width=1920,
        height=1080,
        size_bytes=6_000,
    )

    lifecycle.execute(run_ocr, metadata)

    assert timing_seen_by_ocr == ("constant_frame_rate", 29.97)


def test_ocr_failure_persists_only_a_safe_summary() -> None:
    """Durable OCR errors exclude provider details and signed source URLs."""

    class SafeErrorCursor:
        """Database-boundary double exposing the persisted failure summary."""

        def __init__(self):
            self.write_count = 0
            self.error = None

        def execute(self, sql, params=None):
            """Capture the failure write after creation and timing provenance."""
            self.write_count += 1
            if self.write_count == 3:
                self.error = params[0]

        def fetchone(self):
            """Return one newly processing OCR Run."""
            return ("ocr-run-7", "processing")

    def sensitive_provider_failure():
        """Represent provider text that must never reach durable storage."""
        raise RuntimeError(
            "token=super-secret "
            "https://storage.invalid/creative.png?signature=private"
        )

    cursor = SafeErrorCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="77777777-7777-7777-7777-777777777777",
        source_bucket="uploads",
        source_path="review/private-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=9.0,
        fps=30.0,
        width=1920,
        height=1080,
        size_bytes=7_000,
    )

    with pytest.raises(RuntimeError):
        lifecycle.execute(sensitive_provider_failure, metadata)

    assert cursor.error == "RuntimeError: OCR analysis failed"


def test_zero_fps_fails_before_ocr_analysis() -> None:
    """Invalid CFR timing metadata cannot reach OCR analysis."""

    class TimingFailureCursor:
        """Database-boundary double exposing the invalid-timing run state."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0

        def execute(self, sql, params=None):
            """Model the lifecycle's validation write as a failed transition."""
            self.write_count += 1
            if self.write_count > 1:
                self.status = "failed"

        def fetchone(self):
            """Return one newly processing OCR Run."""
            return ("ocr-run-8", self.status)

    ocr_called = False

    def run_ocr():
        """Expose any provider call made with invalid timing metadata."""
        nonlocal ocr_called
        ocr_called = True
        return object()

    cursor = TimingFailureCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="88888888-8888-8888-8888-888888888888",
        source_bucket="uploads",
        source_path="review/invalid-timing.mp4",
    )
    metadata = VideoMetadata(
        duration_s=5.0,
        fps=0.0,
        width=1920,
        height=1080,
        size_bytes=8_000,
    )

    with pytest.raises(PermanentError, match="frame rate"):
        lifecycle.execute(run_ocr, metadata)

    assert ocr_called is False
    assert cursor.status == "failed"


def test_empty_ocr_result_leaves_run_processing_for_redelivery() -> None:
    """An OCR stub cannot permanently complete a run without a result."""

    class EmptyResultCursor:
        """Database-boundary double exposing an accidental completion write."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0

        def execute(self, sql, params=None):
            """Model creation, timing provenance, then completion."""
            self.write_count += 1
            if self.write_count == 3:
                self.status = "completed"

        def fetchone(self):
            """Return one newly processing OCR Run."""
            return ("ocr-run-9", self.status)

    cursor = EmptyResultCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="99999999-9999-9999-9999-999999999999",
        source_bucket="uploads",
        source_path="review/pending-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=5.0,
        fps=30.0,
        width=1920,
        height=1080,
        size_bytes=9_000,
    )

    result = lifecycle.execute(lambda: None, metadata)

    assert result is None
    assert cursor.status == "processing"


def test_lifecycle_prepares_and_atomically_persists_ocr_analysis() -> None:
    """The lifecycle privately supplies its run identity during completion."""

    class CompletionCursor:
        """Database-boundary double exposing atomic result completion."""

        def __init__(self) -> None:
            self.write_count = 0
            self.atomic_completion_called = False
            self.completion_params = None

        def execute(self, sql, params=None):
            """Model run creation, timing provenance, and atomic completion."""
            self.write_count += 1
            if self.write_count == 3:
                self.atomic_completion_called = True
                self.completion_params = params

        def fetchone(self):
            """Return the run identity first and completion outcome last."""
            if self.write_count == 1:
                return ("ocr-run-completion", "processing")
            return (True,)

    class FakeCompletionCoordinator:
        """Prepare a stable evaluator result without local file I/O."""

        def __init__(self) -> None:
            self.received = None

        def prepare(self, *, ocr_run_id, analysis):
            """Capture the private handoff and return prepared OCR evidence."""
            self.received = (ocr_run_id, analysis)
            return OcrCompletion(
                artifacts=(),
                result_segments=(
                    OcrResultSegment(
                        ocr_id="ocr_segment_0001",
                        frame_ids=("ocr-run-completion-frame-000005",),
                        start_ms=0,
                        end_ms=250,
                        text="SALE",
                        on_screen_duration_ms=250,
                        region_size=8.0,
                        font_size_px=None,
                    ),
                ),
                ocr_segments=(
                    OcrSegment(
                        identifier="ocr_segment_0001",
                        text="SALE",
                        rectangle=(0.1, 0.2, 0.4, 0.2),
                        start_s=0.0,
                        end_s=0.25,
                        duration_s=0.25,
                        confidence=None,
                        representative_frame_index=5,
                        supporting_frame_indexes=(5,),
                        source_text_segment_ids=(
                            "ocr-run-completion-text-segment-0001",
                        ),
                        supporting_readings=(
                            RawOcrReading(
                                source_frame_index=5,
                                timestamp_s=0.25,
                                text="SALE",
                                rectangle=(0.1, 0.2, 0.4, 0.2),
                                confidence=None,
                            ),
                        ),
                    ),
                ),
                text_segments=(
                    TextSegment(
                        identifier=(
                            "ocr-run-completion-text-segment-0001"
                        ),
                        start_s=0.0,
                        end_s=0.25,
                        duration_s=0.25,
                        rectangle=(0.1, 0.2, 0.4, 0.2),
                        detector_confidence=0.8,
                        representative_frame_index=5,
                        candidate_sources=("periodic",),
                        missed_observations=0,
                        timing_uncertainty_s=0.0,
                        observations=(
                            (
                                5,
                                0.25,
                                (0.1, 0.2, 0.4, 0.2),
                                0.8,
                                "stable-region",
                            ),
                        ),
                    ),
                ),
            )

    cursor = CompletionCursor()
    coordinator = FakeCompletionCoordinator()
    analysis = object()
    ocr_calls = 0

    def run_ocr():
        """Prove the analyzer callable remains zero-argument."""
        nonlocal ocr_calls
        ocr_calls += 1
        return analysis

    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        source_bucket="uploads",
        source_path="review/result.mp4",
        completion_coordinator=coordinator,
    )
    metadata = VideoMetadata(
        duration_s=1.0,
        fps=20.0,
        width=200,
        height=100,
        size_bytes=1_000,
    )

    result = lifecycle.execute(run_ocr, metadata)

    assert ocr_calls == 1
    assert coordinator.received == ("ocr-run-completion", analysis)
    assert cursor.atomic_completion_called is True
    assert result.result_segments[0].text == "SALE"
    assert len(cursor.completion_params) == 4
    _, _, ocr_evidence, text_provenance = cursor.completion_params
    assert ocr_evidence.adapted[0]["source_text_segment_ids"] == (
        "ocr-run-completion-text-segment-0001",
    )
    assert ocr_evidence.adapted[0]["supporting_readings"][0]["text"] == (
        "SALE"
    )
    assert text_provenance.adapted[0]["ocr_segment_ids"] == (
        "ocr_segment_0001",
    )
    assert text_provenance.adapted[0]["observations"][0][4] == (
        "stable-region"
    )


@pytest.mark.parametrize(
    "fps",
    [
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="positive-infinity"),
        pytest.param(float("-inf"), id="negative-infinity"),
    ],
)
def test_non_finite_fps_fails_before_ocr_analysis(fps: float) -> None:
    """Non-finite CFR metadata cannot reach OCR analysis."""

    class NonFiniteTimingCursor:
        """Database-boundary double exposing invalid-timing failure."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0

        def execute(self, sql, params=None):
            """Model the lifecycle's validation write as a failed transition."""
            self.write_count += 1
            if self.write_count > 1:
                self.status = "failed"

        def fetchone(self):
            """Return one newly processing OCR Run."""
            return ("ocr-run-10", self.status)

    ocr_called = False

    def run_ocr():
        """Expose any provider call made with non-finite timing metadata."""
        nonlocal ocr_called
        ocr_called = True
        return object()

    cursor = NonFiniteTimingCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        source_bucket="uploads",
        source_path="review/non-finite-timing.mp4",
    )
    metadata = VideoMetadata(
        duration_s=5.0,
        fps=fps,
        width=1920,
        height=1080,
        size_bytes=10_000,
    )

    with pytest.raises(PermanentError, match="finite frame rate"):
        lifecycle.execute(run_ocr, metadata)

    assert ocr_called is False
    assert cursor.status == "failed"
