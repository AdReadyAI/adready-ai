"""Integration tests for the database contract consumed by the Railway worker."""

from decimal import Decimal
import os
from uuid import uuid4

import numpy as np
import psycopg2
from psycopg2.extras import Json
import pytest

import analyzer.fixed_rate_ocr_pipeline as ocr_pipeline
import analyzer.video_analyzer as video_analyzer_module
import app.processor as processor
from analyzer.frame_sampling.probes.text import TextProbeResult, TextSegment
from analyzer.ocr_completion import OcrCompletionCoordinator
from analyzer.ocr_frame_artifacts import LocalOcrFrameArtifactStore
from analyzer.ocr_recognition import (
    DeterministicOcrAdapter,
    DeterministicOcrObservation,
)
from analyzer.types import Artifacts, VideoMetadata
from analyzer.video_analyzer import VideoAnalyzer
from app.ocr_runs import OcrRunLifecycle


@pytest.mark.integration
def test_jobs_queue_and_enqueue_function_exist() -> None:
    """Migrations must expose both sides of the durable media-job boundary."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            # The worker reads this queue, while trusted Supabase code calls enqueue_job.
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name = %s);",
                ("jobs",),
            )
            queue_exists = cursor.fetchone()[0]
            cursor.execute("SELECT to_regprocedure('public.enqueue_job(jsonb)') IS NOT NULL;")
            enqueue_function_exists = cursor.fetchone()[0]

    assert queue_exists
    assert enqueue_function_exists


@pytest.mark.integration
def test_ocr_run_schema_supports_idempotent_worker_redelivery() -> None:
    """The durable OCR contract reuses one generated run for one video request."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    user_id = str(uuid4())
    request_id = str(uuid4())
    invalid_timing_request_id = str(uuid4())
    fixture_created = False

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            try:
                cursor.execute(
                    "SELECT to_regclass('public.ocr_runs');"
                )
                assert cursor.fetchone()[0] is not None
                cursor.execute(
                    """
                    SELECT
                      relrowsecurity,
                      has_table_privilege(
                        'service_role',
                        'public.ocr_runs',
                        'select, insert, update'
                      )
                    FROM pg_class
                    WHERE oid = 'public.ocr_runs'::regclass;
                    """
                )
                rls_enabled, worker_access = cursor.fetchone()
                assert rls_enabled
                assert worker_access

                # The Review Request foreign key anchors the OCR-local identity
                # to the existing one-video-per-request worker contract.
                cursor.execute(
                    """
                    INSERT INTO auth.users (
                      id, instance_id, aud, role, email,
                      created_at, updated_at
                    )
                    VALUES (
                      %s, '00000000-0000-0000-0000-000000000000',
                      'authenticated', 'authenticated', %s, now(), now()
                    );
                    """,
                    (user_id, f"ocr-{user_id}@example.invalid"),
                )
                cursor.execute(
                    """
                    INSERT INTO requests (request_id, user_id)
                    VALUES
                      (%s, %s),
                      (%s, %s);
                    """,
                    (
                        request_id,
                        user_id,
                        invalid_timing_request_id,
                        user_id,
                    ),
                )
                fixture_created = True

                cursor.execute(
                    """
                    INSERT INTO ocr_runs (
                      request_id,
                      source_bucket,
                      source_path
                    )
                    VALUES (%s, %s, %s)
                    RETURNING ocr_run_id, status;
                    """,
                    (
                        request_id,
                        "uploads",
                        "user/creative.mp4",
                    ),
                )
                first_run_id, first_status = cursor.fetchone()

                # Redelivery resolves through the stable identity and returns
                # the database-generated run rather than inserting another row.
                cursor.execute(
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
                        request_id,
                        "uploads",
                        "user/creative.mp4",
                    ),
                )
                resumed_run_id, resumed_status = cursor.fetchone()

                assert first_status == "processing"
                assert resumed_status == "processing"
                assert resumed_run_id == first_run_id
                cursor.execute(
                    """
                    SELECT count(*)
                    FROM ocr_runs
                    WHERE request_id = %s;
                    """,
                    (request_id,),
                )
                assert cursor.fetchone()[0] == 1

                cursor.execute("SAVEPOINT invalid_timing")
                with pytest.raises(psycopg2.errors.CheckViolation):
                    cursor.execute(
                        """
                        INSERT INTO ocr_runs (
                          request_id,
                          source_bucket,
                          source_path,
                          timing_source
                        )
                        VALUES (%s, %s, %s, 'constant_frame_rate');
                        """,
                        (
                            invalid_timing_request_id,
                            "uploads",
                            "user/second-creative.mp4",
                        ),
                    )
                cursor.execute("ROLLBACK TO SAVEPOINT invalid_timing")
            finally:
                # Request deletion cascades into the OCR Run; removing the local
                # auth fixture keeps repeated integration runs independent.
                if fixture_created:
                    cursor.execute(
                        """
                        DELETE FROM requests
                        WHERE request_id IN (%s, %s);
                        """,
                        (request_id, invalid_timing_request_id),
                    )
                    cursor.execute(
                        "DELETE FROM auth.users WHERE id = %s;",
                        (user_id,),
                    )


@pytest.mark.integration
def test_ocr_lifecycle_persists_cfr_provenance_while_resumable() -> None:
    """Deferred OCR stays resumable after recording honest CFR timing."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    user_id = str(uuid4())
    request_id = str(uuid4())

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            try:
                cursor.execute(
                    """
                    INSERT INTO auth.users (
                      id, instance_id, aud, role, email,
                      created_at, updated_at
                    )
                    VALUES (
                      %s, '00000000-0000-0000-0000-000000000000',
                      'authenticated', 'authenticated', %s, now(), now()
                    );
                    """,
                    (user_id, f"ocr-lifecycle-{user_id}@example.invalid"),
                )
                cursor.execute(
                    """
                    INSERT INTO requests (request_id, user_id)
                    VALUES (%s, %s);
                    """,
                    (request_id, user_id),
                )
                fixture_created = True

                lifecycle = OcrRunLifecycle(
                    cur=cursor,
                    request_id=request_id,
                    source_bucket="uploads",
                    source_path="review/creative.mp4",
                )
                metadata = VideoMetadata(
                    duration_s=10.0,
                    fps=29.97,
                    width=1920,
                    height=1080,
                    size_bytes=1_000,
                )

                lifecycle.execute(lambda: None, metadata)

                cursor.execute(
                    """
                    SELECT status, timing_source, fallback_fps
                    FROM ocr_runs
                    WHERE request_id = %s;
                    """,
                    (request_id,),
                )
                assert cursor.fetchone() == (
                    "processing",
                    "constant_frame_rate",
                    Decimal("29.97"),
                )
            finally:
                # The request cascade removes its OCR Run; the auth fixture is
                # then deleted so repeated local integration runs stay isolated.
                if fixture_created:
                    cursor.execute(
                        "DELETE FROM requests WHERE request_id = %s;",
                        (request_id,),
                    )
                    cursor.execute(
                        "DELETE FROM auth.users WHERE id = %s;",
                        (user_id,),
                    )


@pytest.mark.integration
def test_ocr_result_is_atomic_retrievable_and_immutable_by_run_id() -> None:
    """Repeated completion preserves one evaluator-facing OCR Result."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    user_id = str(uuid4())
    request_id = str(uuid4())
    processing_request_id = str(uuid4())
    fixture_created = False

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            try:
                cursor.execute(
                    """
                    INSERT INTO auth.users (
                      id, instance_id, aud, role, email,
                      created_at, updated_at
                    )
                    VALUES (
                      %s, '00000000-0000-0000-0000-000000000000',
                      'authenticated', 'authenticated', %s, now(), now()
                    );
                    """,
                    (user_id, f"ocr-result-{user_id}@example.invalid"),
                )
                cursor.execute(
                    """
                    INSERT INTO requests (request_id, user_id)
                    VALUES
                      (%s, %s),
                      (%s, %s);
                    """,
                    (
                        request_id,
                        user_id,
                        processing_request_id,
                        user_id,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO ocr_runs (
                      request_id,
                      source_bucket,
                      source_path,
                      timing_source,
                      fallback_fps
                    )
                    VALUES (%s, 'uploads', 'review/result.mp4',
                            'constant_frame_rate', 20)
                    RETURNING ocr_run_id;
                    """,
                    (request_id,),
                )
                ocr_run_id = cursor.fetchone()[0]
                cursor.execute(
                    """
                    INSERT INTO ocr_runs (
                      request_id,
                      source_bucket,
                      source_path
                    )
                    VALUES (%s, 'uploads', 'review/processing-result.mp4')
                    RETURNING ocr_run_id;
                    """,
                    (processing_request_id,),
                )
                processing_ocr_run_id = cursor.fetchone()[0]
                original_segment = {
                    "ocr_id": "ocr_segment_0001",
                    "frame_ids": [
                        "ocr-frame-000000",
                        "ocr-frame-000005",
                    ],
                    "start_ms": 0,
                    "end_ms": 250,
                    "text": "SALE",
                    "on_screen_duration_ms": 250,
                    "region_size": 8.0,
                    "font_size_px": None,
                }

                cursor.execute(
                    "SELECT complete_ocr_run(%s, %s::jsonb);",
                    (ocr_run_id, Json([original_segment])),
                )
                assert cursor.fetchone()[0] is True

                changed_segment = {
                    **original_segment,
                    "text": "MUTATED",
                    "end_ms": 500,
                    "on_screen_duration_ms": 500,
                }
                cursor.execute(
                    "SELECT complete_ocr_run(%s, %s::jsonb);",
                    (ocr_run_id, Json([changed_segment])),
                )
                assert cursor.fetchone()[0] is False

                cursor.execute(
                    """
                    SELECT
                      r.ocr_run_id,
                      s.ocr_id,
                      s.frame_ids,
                      s.start_ms,
                      s.end_ms,
                      s.text,
                      s.on_screen_duration_ms,
                      s.region_size,
                      s.font_size_px
                    FROM ocr_results AS r
                    JOIN ocr_segments AS s
                      ON s.ocr_run_id = r.ocr_run_id
                    WHERE r.ocr_run_id = %s;
                    """,
                    (ocr_run_id,),
                )
                assert cursor.fetchone() == (
                    ocr_run_id,
                    "ocr_segment_0001",
                    ["ocr-frame-000000", "ocr-frame-000005"],
                    0,
                    250,
                    "SALE",
                    250,
                    Decimal("8.0"),
                    None,
                )
                cursor.execute(
                    "SELECT status FROM ocr_runs WHERE ocr_run_id = %s;",
                    (ocr_run_id,),
                )
                assert cursor.fetchone()[0] == "completed"

                cursor.execute("SET LOCAL ROLE service_role;")
                cursor.execute("SAVEPOINT immutable_result_header")
                with pytest.raises(psycopg2.errors.InsufficientPrivilege):
                    cursor.execute(
                        """
                        INSERT INTO ocr_results (ocr_run_id)
                        VALUES (%s);
                        """,
                        (processing_ocr_run_id,),
                    )
                cursor.execute(
                    "ROLLBACK TO SAVEPOINT immutable_result_header"
                )
                cursor.execute("RESET ROLE;")

                cursor.execute(
                    """
                    INSERT INTO ocr_segments (
                      request_id,
                      ocr_id,
                      frame_ids,
                      start_ms,
                      end_ms,
                      text,
                      on_screen_duration_ms
                    )
                    VALUES (%s, 'legacy_segment', '{}', 0, 100,
                            'LEGACY', 100);
                    """,
                    (request_id,),
                )
                cursor.execute("SET LOCAL ROLE service_role;")
                cursor.execute(
                    """
                    UPDATE ocr_segments
                    SET text = 'UPDATED LEGACY'
                    WHERE request_id = %s
                      AND ocr_id = 'legacy_segment';
                    """,
                    (request_id,),
                )
                assert cursor.rowcount == 1
                cursor.execute(
                    """
                    DELETE FROM ocr_segments
                    WHERE request_id = %s
                      AND ocr_id = 'legacy_segment';
                    """,
                    (request_id,),
                )
                assert cursor.rowcount == 1

                cursor.execute("SAVEPOINT immutable_result_insert")
                with pytest.raises(
                    psycopg2.errors.RaiseException,
                    match=(
                        "run-owned OCR Segment can only be inserted "
                        "by complete_ocr_run"
                    ),
                ):
                    cursor.execute(
                        """
                        INSERT INTO ocr_segments (
                          request_id,
                          ocr_run_id,
                          ocr_id,
                          frame_ids,
                          start_ms,
                          end_ms,
                          text,
                          on_screen_duration_ms
                        )
                        VALUES (%s, %s, 'ocr_segment_0002', '{}',
                                250, 500, 'APPENDED', 250);
                        """,
                        (request_id, ocr_run_id),
                    )
                cursor.execute(
                    "ROLLBACK TO SAVEPOINT immutable_result_insert"
                )

                for operation in ("UPDATE", "DELETE"):
                    cursor.execute("SAVEPOINT immutable_result_segment")
                    with pytest.raises(
                        psycopg2.errors.RaiseException,
                        match="run-owned OCR Segment is immutable",
                    ):
                        if operation == "UPDATE":
                            cursor.execute(
                                """
                                UPDATE ocr_segments
                                SET text = 'MUTATED'
                                WHERE ocr_run_id = %s;
                                """,
                                (ocr_run_id,),
                            )
                        else:
                            cursor.execute(
                                """
                                DELETE FROM ocr_segments
                                WHERE ocr_run_id = %s;
                                """,
                                (ocr_run_id,),
                            )
                    # Each expected trigger error aborts its savepoint only;
                    # rollback keeps the surrounding retrieval fixture usable.
                    cursor.execute(
                        "ROLLBACK TO SAVEPOINT immutable_result_segment"
                    )

                cursor.execute("RESET ROLE;")
                cursor.execute(
                    "DELETE FROM requests WHERE request_id = %s;",
                    (request_id,),
                )
                cursor.execute(
                    """
                    SELECT
                      (SELECT count(*) FROM ocr_runs
                       WHERE ocr_run_id = %s),
                      (SELECT count(*) FROM ocr_results
                       WHERE ocr_run_id = %s),
                      (SELECT count(*) FROM ocr_segments
                       WHERE ocr_run_id = %s);
                    """,
                    (ocr_run_id, ocr_run_id, ocr_run_id),
                )
                assert cursor.fetchone() == (0, 0, 0)
            finally:
                # Rollback removes fixtures even when PostgreSQL has aborted
                # the transaction at the expected pre-migration red seam.
                connection.rollback()


@pytest.mark.integration
def test_fixed_rate_ocr_completes_idempotently_through_worker(
    monkeypatch,
    tmp_path,
) -> None:
    """One synthetic Ad Creative completes through the real worker OCR seam."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    user_id = str(uuid4())
    request_id = str(uuid4())
    capture_open_count = 0

    class FakeCapture:
        """Decode two deterministic source frames for fixed-rate OCR."""

        def __init__(self) -> None:
            self._frames = iter(
                (
                    np.zeros((100, 200, 3), dtype=np.uint8),
                    np.ones((100, 200, 3), dtype=np.uint8),
                )
            )

        def isOpened(self):
            """Report that the synthetic Ad Creative opened successfully."""
            return True

        def read(self):
            """Return each source frame once, then signal end of stream."""
            try:
                return True, next(self._frames)
            except StopIteration:
                return False, None

        def release(self):
            """Release the synthetic decoder without external resources."""

    def open_capture(video_path):
        """Count OCR decodes so redelivery cannot silently repeat work."""
        nonlocal capture_open_count
        capture_open_count += 1
        return FakeCapture()

    class SyntheticPreprocessor:
        """Supply trusted local media while preserving the worker entry point."""

        def __init__(self, payload, work_dir):
            self.payload = payload
            self.work_dir = work_dir

        def prepare(self):
            """Return one synthetic Ad Creative with optional detector evidence."""
            text_segment = TextSegment(
                identifier="text_segment_0001",
                start_s=0.0,
                end_s=0.25,
                duration_s=0.25,
                rectangle=(0.1, 0.1, 0.4, 0.2),
                detector_confidence=0.8,
                representative_frame_index=0,
                candidate_sources=("periodic",),
                missed_observations=0,
                timing_uncertainty_s=0.0,
            )
            return Artifacts(
                job_id=self.payload.request_id,
                storage_ref=(
                    f"{self.payload.bucket}/{self.payload.video_path}"
                ),
                video_path="synthetic.mp4",
                audio_path="synthetic.wav",
                frames=(),
                video_metadata=VideoMetadata(
                    duration_s=0.3,
                    fps=4.0,
                    width=200,
                    height=100,
                    size_bytes=1_000,
                ),
                work_dir=self.work_dir,
                probe_results={
                    "text": TextProbeResult(
                        text_segments=[text_segment]
                    ),
                },
            )

    adapter = DeterministicOcrAdapter(
        observations_by_frame={
            index: (
                DeterministicOcrObservation(
                    text="SALE",
                    rectangle_pixels=(20, 10, 80, 20),
                    confidence=0.9,
                ),
            )
            for index in (0, 1)
        }
    )

    class NoOpGenericPersistence:
        """Confirm OCR bypasses the generalized task-result tables."""

        def __init__(self, cur, request_id):
            self.request_id = request_id

        def completed_analyzers(self):
            """Leave only OCR pending through the real analyzer registry."""
            return {"transcription", "object_detection", "context"}

        def persist_results(self, results, errors):
            """Accept only the empty generic envelope after OCR completion."""
            assert results == {}
            assert errors == {}

    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        open_capture,
    )
    monkeypatch.setattr(
        video_analyzer_module,
        "get_aai_transcriber",
        lambda: object(),
    )
    monkeypatch.setattr(
        processor,
        "VideoPreprocessor",
        SyntheticPreprocessor,
    )
    monkeypatch.setattr(
        processor,
        "_build_ocr_adapter",
        lambda: adapter,
    )
    monkeypatch.setattr(
        processor,
        "_build_ocr_completion_coordinator",
        lambda: OcrCompletionCoordinator(
            artifact_store=LocalOcrFrameArtifactStore(
                work_dir=str(tmp_path),
            )
        ),
    )
    monkeypatch.setattr(
        processor,
        "Supabase",
        NoOpGenericPersistence,
    )

    payload = {
        "request_id": request_id,
        "bucket": "uploads",
        "video_path": "review/synthetic.mp4",
        "product_image_paths": [],
        "logo_paths": [],
    }

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            try:
                cursor.execute(
                    """
                    INSERT INTO auth.users (
                      id, instance_id, aud, role, email,
                      created_at, updated_at
                    )
                    VALUES (
                      %s, '00000000-0000-0000-0000-000000000000',
                      'authenticated', 'authenticated', %s, now(), now()
                    );
                    """,
                    (user_id, f"ocr-worker-{user_id}@example.invalid"),
                )
                cursor.execute(
                    """
                    INSERT INTO requests (request_id, user_id)
                    VALUES (%s, %s);
                    """,
                    (request_id, user_id),
                )

                processor.process_message(cursor, 101, payload)
                cursor.execute(
                    """
                    SELECT r.ocr_run_id, run.status
                    FROM ocr_results AS r
                    JOIN ocr_runs AS run USING (ocr_run_id)
                    WHERE run.request_id = %s;
                    """,
                    (request_id,),
                )
                ocr_run_id, status = cursor.fetchone()
                assert status == "completed"
                cursor.execute(
                    """
                    SELECT
                      ocr_id,
                      frame_ids,
                      start_ms,
                      end_ms,
                      text,
                      on_screen_duration_ms,
                      region_size,
                      font_size_px
                    FROM ocr_segments
                    WHERE ocr_run_id = %s;
                    """,
                    (ocr_run_id,),
                )
                first_result = cursor.fetchone()
                assert first_result == (
                    "ocr_segment_0001",
                    [f"{ocr_run_id}-frame-000000"],
                    0,
                    250,
                    "SALE",
                    250,
                    Decimal("8.0"),
                    None,
                )
                representative_path = (
                    tmp_path
                    / "ocr-artifacts"
                    / ocr_run_id
                    / f"{ocr_run_id}-frame-000000.jpg"
                )
                # The database reference is useful only while its source
                # evidence remains available after per-message cleanup.
                assert representative_path.is_file()

                processor.process_message(cursor, 102, payload)
                cursor.execute(
                    """
                    SELECT
                      (SELECT count(*) FROM ocr_results
                       WHERE ocr_run_id = %s),
                      (SELECT count(*) FROM ocr_segments
                       WHERE ocr_run_id = %s);
                    """,
                    (ocr_run_id, ocr_run_id),
                )
                assert cursor.fetchone() == (1, 1)
                cursor.execute(
                    """
                    SELECT
                      ocr_id,
                      frame_ids,
                      start_ms,
                      end_ms,
                      text,
                      on_screen_duration_ms,
                      region_size,
                      font_size_px
                    FROM ocr_segments
                    WHERE ocr_run_id = %s;
                    """,
                    (ocr_run_id,),
                )
                assert cursor.fetchone() == first_result
                assert capture_open_count == 1
            finally:
                connection.rollback()
