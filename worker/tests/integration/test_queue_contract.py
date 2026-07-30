"""Integration tests for the database contract consumed by the Railway worker."""

from decimal import Decimal
import os
from uuid import uuid4

import psycopg2
import pytest

from analyzer.types import VideoMetadata
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
def test_ocr_lifecycle_persists_success_and_cfr_provenance() -> None:
    """Successful OCR leaves its durable run completed with honest timing."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    user_id = str(uuid4())
    request_id = str(uuid4())
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

                lifecycle.execute(lambda: object(), metadata)

                cursor.execute(
                    """
                    SELECT status, timing_source, fallback_fps
                    FROM ocr_runs
                    WHERE request_id = %s;
                    """,
                    (request_id,),
                )
                assert cursor.fetchone() == (
                    "completed",
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
