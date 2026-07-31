"""Durable lifecycle coordination contained within the OCR analysis slice."""

from collections.abc import Callable
from dataclasses import asdict
import math
from typing import TypeVar

from psycopg2.extras import Json

from analyzer.ocr.completion import OcrCompletionCoordinator
from analyzer.types import VideoMetadata
from app.errors import PermanentError


OcrResultT = TypeVar("OcrResultT")


class OcrRunLifecycle:
    """Create or resume one durable OCR Run around OCR analysis."""

    def __init__(
        self,
        cur,
        request_id: str,
        source_bucket: str,
        source_path: str,
        completion_coordinator: OcrCompletionCoordinator | None = None,
    ):
        """Retain only the trusted identity and source needed by OCR."""
        self.cur = cur
        self.request_id = request_id
        self.source_bucket = source_bucket
        self.source_path = source_path
        self.completion_coordinator = completion_coordinator

    def execute(
        self,
        run_ocr: Callable[[], OcrResultT],
        metadata: VideoMetadata,
    ) -> OcrResultT | None:
        """Reuse completed work or execute OCR for a processing run."""
        self.cur.execute(
            """
            INSERT INTO ocr_runs (
              request_id,
              source_bucket,
              source_path
            )
            VALUES (%s, %s, %s)
            ON CONFLICT (request_id)
            DO UPDATE SET updated_at = ocr_runs.updated_at
            RETURNING ocr_run_id, status;
            """,
            (
                self.request_id,
                self.source_bucket,
                self.source_path,
            ),
        )
        ocr_run_id, status = self.cur.fetchone()

        # Durable completion is authoritative on redelivery, so OCR must
        # not be repeated even when the queue delivers the request again.
        if status == "completed":
            return None

        if metadata.duration_s > 60:
            # The OCR duration limit belongs to this analysis slice; rejecting
            # here leaves shared preprocessing and non-OCR analyses unchanged.
            self._mark_failed(ocr_run_id)
            raise PermanentError("OCR supports Ad Creatives up to 60 seconds")

        if not math.isfinite(metadata.fps):
            # NaN and infinite rates cannot produce bounded OCR timestamps and
            # must not rely on database comparison behavior for validation.
            self._mark_failed(ocr_run_id)
            raise PermanentError("OCR requires a finite frame rate")

        if metadata.fps <= 0:
            # OCR timing cannot be reconstructed from frame indexes without a
            # positive source rate, so fail before recording invalid provenance.
            self._mark_failed(ocr_run_id)
            raise PermanentError("OCR requires a positive frame rate")

        # The current decoder derives timestamps from frame index and FPS.
        # Persist that fallback explicitly before OCR analysis begins.
        self.cur.execute(
            """
            UPDATE ocr_runs
            SET timing_source = %s,
                fallback_fps = %s,
                updated_at = now()
            WHERE ocr_run_id = %s;
            """,
            (
                "constant_frame_rate",
                metadata.fps,
                ocr_run_id,
            ),
        )

        try:
            result = run_ocr()
        except Exception as error:
            # Preserve the analysis exception for the existing processor while
            # durable storage receives only a non-sensitive operational summary.
            safe_error = f"{type(error).__name__}: OCR analysis failed"
            self._mark_failed(ocr_run_id, safe_error)
            raise

        # Analyzer stubs and deferred providers return None. Keep the OCR Run
        # resumable until the analysis produces an actual result to persist.
        if result is None:
            return None

        if self.completion_coordinator is None:
            # In-memory analysis is not a completed OCR Result: durable frame
            # evidence and atomic result rows are required by the OCR contract.
            error = RuntimeError("OCR completion is not configured")
            self._mark_failed(
                ocr_run_id,
                "RuntimeError: OCR completion is not configured",
            )
            raise error

        try:
            completion = self.completion_coordinator.prepare(
                ocr_run_id=str(ocr_run_id),
                analysis=result,
            )
            self.cur.execute(
                "SELECT complete_ocr_run(%s, %s::jsonb);",
                (
                    ocr_run_id,
                    Json(
                        [
                            asdict(segment)
                            for segment in completion.result_segments
                        ]
                    ),
                ),
            )
            result_created = self.cur.fetchone()[0]
        except Exception as error:
            # Artifact and result details remain outside durable failures;
            # only a short operational category is safe to persist.
            safe_error = f"{type(error).__name__}: OCR completion failed"
            self._mark_failed(ocr_run_id, safe_error)
            raise
        return completion if result_created else None

    def _mark_failed(
        self,
        ocr_run_id: str,
        safe_error: str | None = None,
    ) -> None:
        """Persist one OCR-owned failure with optional sanitized context."""
        self.cur.execute(
            """
            UPDATE ocr_runs
            SET status = 'failed',
                error = %s,
                updated_at = now()
            WHERE ocr_run_id = %s;
            """,
            (
                safe_error,
                ocr_run_id,
            ),
        )
