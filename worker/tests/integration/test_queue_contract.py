"""Integration tests for the database contract consumed by the Railway worker."""

import os

import psycopg2
import pytest


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
def test_video_processing_status_check_allows_processing() -> None:
    """The 'processing' status must be a valid in-flight state, not just success/error."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = 'public.video_processing'::regclass
                  AND conname = 'video_processing_status_check';
                """
            )
            row = cursor.fetchone()

    assert row is not None, "video_processing_status_check constraint is missing"
    constraint_def = row[0]
    assert "processing" in constraint_def
    assert "success" in constraint_def
    assert "error" in constraint_def
