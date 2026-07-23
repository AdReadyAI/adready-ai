"""Integration tests for the database contract consumed by the Railway worker."""

import os
from uuid import uuid4

import psycopg2
import pytest

from app.schemas import JobPayload
from app.supabase import Supabase


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
def test_ad_creative_and_ocr_run_identity_contract_exists() -> None:
    """The durable schema must support idempotent OCR Run redelivery."""

    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    to_regclass('public.ad_creatives') IS NOT NULL,
                    to_regclass('public.ocr_runs') IS NOT NULL;
                """
            )
            ad_creatives_exist, ocr_runs_exist = cursor.fetchone()
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conrelid = 'public.ocr_runs'::regclass
                      AND contype = 'c'
                      AND pg_get_constraintdef(oid)
                          LIKE '%processing%completed%failed%'
                );
                """
            )
            status_constraint_exists = cursor.fetchone()[0]

    assert ad_creatives_exist
    assert ocr_runs_exist
    assert status_constraint_exists


@pytest.mark.integration
def test_ocr_run_redelivery_uses_one_durable_run() -> None:
    """The real database boundary must make queue redelivery idempotent."""
    database_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    user_id = uuid4()
    request_id = uuid4()
    payload = JobPayload(
        request_id=request_id,
        ad_creative_id=uuid4(),
        ocr_run_id=uuid4(),
        requested_analyses=("ocr",),
        bucket="videos",
        video_path="integration/creative.mp4",
    )

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            try:
                # The Review Request foreign key is part of the durable identity
                # contract, so create the smallest local authenticated principal.
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
                    "INSERT INTO requests (request_id, user_id) VALUES (%s, %s);",
                    (request_id, user_id),
                )
                connection.commit()

                store = Supabase(cursor, request_id)
                assert store.create_or_resume_ocr_run(payload) == "processing"
                assert store.create_or_resume_ocr_run(payload) == "processing"

                cursor.execute(
                    "SELECT count(*) FROM ocr_runs WHERE ocr_run_id = %s;",
                    (payload.ocr_run_id,),
                )
                assert cursor.fetchone()[0] == 1

                cursor.execute(
                    "UPDATE ocr_runs SET status = 'completed' WHERE ocr_run_id = %s;",
                    (payload.ocr_run_id,),
                )
                connection.commit()
                assert store.create_or_resume_ocr_run(payload) == "completed"
            finally:
                # Explicit cleanup keeps repeat local runs independent even though
                # the store commits its own transaction boundary.
                cursor.execute("DELETE FROM requests WHERE request_id = %s;", (request_id,))
                cursor.execute("DELETE FROM auth.users WHERE id = %s;", (user_id,))
                connection.commit()
