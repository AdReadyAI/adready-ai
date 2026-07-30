"""Behavior tests for the OCR-owned durable run lifecycle."""

import pytest

pytestmark = pytest.mark.unit

from analyzer.types import VideoMetadata  # noqa: E402
from app.errors import PermanentError  # noqa: E402
from app.ocr_runs import OcrRunLifecycle  # noqa: E402


class CompletedRunCursor:
    """Database-boundary double returning one previously completed OCR Run."""

    def execute(self, sql, params=None):
        """Accept the lifecycle query without coupling the test to its SQL."""

    def fetchone(self):
        """Return the durable run identity and completed lifecycle state."""
        return ("ocr-run-1", "completed")


def test_completed_redelivery_does_not_repeat_hosted_ocr() -> None:
    """A completed OCR Run is reused without repeating billable OCR work."""
    hosted_ocr_called = False

    def hosted_ocr():
        """Make an accidental hosted OCR invocation observable to the test."""
        nonlocal hosted_ocr_called
        hosted_ocr_called = True
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

    result = lifecycle.execute(hosted_ocr, metadata)

    assert result is None
    assert hosted_ocr_called is False


def test_processing_run_executes_hosted_ocr_once() -> None:
    """A new or resumed processing run returns its hosted OCR result."""
    hosted_result = object()
    hosted_ocr_calls = 0

    def hosted_ocr():
        """Return a stable sentinel while exposing duplicate provider calls."""
        nonlocal hosted_ocr_calls
        hosted_ocr_calls += 1
        return hosted_result

    class ProcessingRunCursor:
        """Database-boundary double returning one in-progress OCR Run."""

        def execute(self, sql, params=None):
            """Accept lifecycle statements without asserting their SQL shape."""

        def fetchone(self):
            """Return the durable run identity and processing lifecycle state."""
            return ("ocr-run-2", "processing")

    lifecycle = OcrRunLifecycle(
        cur=ProcessingRunCursor(),
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

    result = lifecycle.execute(hosted_ocr, metadata)

    assert result is hosted_result
    assert hosted_ocr_calls == 1


def test_successful_hosted_ocr_completes_the_durable_run() -> None:
    """Successful hosted OCR leaves the associated durable run completed."""

    class DurableRunCursor:
        """Database-boundary double exposing the run state after each write."""

        def __init__(self):
            self.status = "processing"
            self.write_count = 0

        def execute(self, sql, params=None):
            """Model the durable state transition without inspecting SQL text."""
            self.write_count += 1
            if self.write_count > 1:
                self.status = "completed"

        def fetchone(self):
            """Return the current durable run identity and lifecycle state."""
            return ("ocr-run-3", self.status)

    cursor = DurableRunCursor()
    lifecycle = OcrRunLifecycle(
        cur=cursor,
        request_id="33333333-3333-3333-3333-333333333333",
        source_bucket="uploads",
        source_path="review/successful-creative.mp4",
    )
    metadata = VideoMetadata(
        duration_s=6.0,
        fps=30.0,
        width=1920,
        height=1080,
        size_bytes=3_000,
    )

    lifecycle.execute(lambda: object(), metadata)

    assert cursor.status == "completed"


def test_hosted_ocr_failure_marks_run_failed_and_reraises() -> None:
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

    def failed_hosted_ocr():
        """Represent a provider failure that the processor must still receive."""
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
        lifecycle.execute(failed_hosted_ocr, metadata)

    assert cursor.status == "failed"


def test_creative_over_sixty_seconds_fails_before_hosted_ocr() -> None:
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

    hosted_ocr_called = False

    def hosted_ocr():
        """Expose any provider call made before duration validation."""
        nonlocal hosted_ocr_called
        hosted_ocr_called = True
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
        lifecycle.execute(hosted_ocr, metadata)

    assert hosted_ocr_called is False
    assert cursor.status == "failed"


def test_cfr_fallback_is_recorded_before_hosted_ocr() -> None:
    """Current frame-index timing is made explicit before provider work."""

    class TimingRunCursor:
        """Database-boundary double exposing timing provenance to hosted OCR."""

        def __init__(self):
            self.write_count = 0
            self.timing = None

        def execute(self, sql, params=None):
            """Capture the lifecycle write between creation and hosted OCR."""
            self.write_count += 1
            if self.write_count == 2:
                self.timing = params[:2]

        def fetchone(self):
            """Return one newly processing OCR Run."""
            return ("ocr-run-6", "processing")

    cursor = TimingRunCursor()
    timing_seen_by_hosted_ocr = None

    def hosted_ocr():
        """Observe timing provenance at the external-provider boundary."""
        nonlocal timing_seen_by_hosted_ocr
        timing_seen_by_hosted_ocr = cursor.timing
        return object()

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

    lifecycle.execute(hosted_ocr, metadata)

    assert timing_seen_by_hosted_ocr == ("constant_frame_rate", 29.97)


def test_hosted_failure_persists_only_a_safe_summary() -> None:
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

    assert cursor.error == "RuntimeError: hosted OCR failed"


def test_zero_fps_fails_before_hosted_ocr() -> None:
    """Invalid CFR timing metadata cannot reach the hosted OCR provider."""

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

    hosted_ocr_called = False

    def hosted_ocr():
        """Expose any provider call made with invalid timing metadata."""
        nonlocal hosted_ocr_called
        hosted_ocr_called = True
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
        lifecycle.execute(hosted_ocr, metadata)

    assert hosted_ocr_called is False
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


@pytest.mark.parametrize(
    "fps",
    [
        pytest.param(float("nan"), id="nan"),
        pytest.param(float("inf"), id="positive-infinity"),
        pytest.param(float("-inf"), id="negative-infinity"),
    ],
)
def test_non_finite_fps_fails_before_hosted_ocr(fps: float) -> None:
    """Non-finite CFR metadata cannot reach the hosted OCR provider."""

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

    hosted_ocr_called = False

    def hosted_ocr():
        """Expose any provider call made with non-finite timing metadata."""
        nonlocal hosted_ocr_called
        hosted_ocr_called = True
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
        lifecycle.execute(hosted_ocr, metadata)

    assert hosted_ocr_called is False
    assert cursor.status == "failed"
