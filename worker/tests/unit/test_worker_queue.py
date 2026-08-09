"""Unit tests for the worker's durable-message lifecycle."""

from contextlib import nullcontext
from unittest.mock import Mock

import pytest

import app.worker_queue as worker_queue  # noqa: E402  (configuration must be initialized before this import)
from app.errors import UnrecoverableError  # noqa: E402


@pytest.mark.unit
def test_successful_message_is_processed_and_deleted(monkeypatch: pytest.MonkeyPatch) -> None:
    """A completed job must be deleted so it cannot be delivered a second time."""
    cursor = Mock()
    cursor.fetchone.side_effect = [
        (42, 1, {"review_id": "review-1"}),
        None,
    ]
    process_message = Mock()
    monkeypatch.setattr(worker_queue, "process_message", process_message)
    worker_queue.set_running(True)

    # drain_queue loops until PGMQ reports no more messages, so the second row ends the drain.
    # Heartbeat owns a separate database connection; this unit test supplies
    # an inert boundary so it exercises only queue processing and deletion.
    processed = worker_queue.drain_queue(
        cursor,
        heartbeat_factory=lambda **_kwargs: nullcontext(),
    )

    assert processed == 1
    process_message.assert_called_once_with(
        cursor,
        42,
        {"review_id": "review-1"},
    )   
    cursor.execute.assert_any_call("SELECT pgmq.delete(%s, %s);", ("jobs", 42))


@pytest.mark.unit
def test_failed_message_is_retried_with_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """A transient/generic failure must be requeued, not archived."""
    cursor = Mock()
    cursor.fetchone.side_effect = [
        (42, 1, {"review_id": "review-1"}),
        None,
    ]
    monkeypatch.setattr(
        worker_queue, "process_message", Mock(side_effect=RuntimeError("boom"))
    )
    worker_queue.set_running(True)

    processed = worker_queue.drain_queue(
        cursor,
        heartbeat_factory=lambda **_kwargs: nullcontext(),
    )

    assert processed == 0
    set_vt_calls = [
        call for call in cursor.execute.call_args_list
        if call.args[0].startswith("SELECT pgmq.set_vt")
    ]
    assert len(set_vt_calls) == 1
    archive_calls = [
        call for call in cursor.execute.call_args_list
        if call.args[0].startswith("SELECT pgmq.archive")
    ]
    assert archive_calls == []


@pytest.mark.unit
def test_unrecoverable_message_is_archived_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    """A permanent failure must be archived on the first attempt, not requeued."""
    cursor = Mock()
    cursor.fetchone.side_effect = [
        (42, 1, {"review_id": "review-1"}),
        None,
    ]
    monkeypatch.setattr(
        worker_queue,
        "process_message",
        Mock(side_effect=UnrecoverableError("never gonna work")),
    )
    worker_queue.set_running(True)

    processed = worker_queue.drain_queue(
        cursor,
        heartbeat_factory=lambda **_kwargs: nullcontext(),
    )

    assert processed == 0
    cursor.execute.assert_any_call("SELECT pgmq.archive(%s, %s);", ("jobs", 42))
    set_vt_calls = [
        call for call in cursor.execute.call_args_list
        if call.args[0].startswith("SELECT pgmq.set_vt")
    ]
    assert set_vt_calls == []


@pytest.mark.unit
def test_unrecoverable_message_records_the_detailed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The real failure reason must be persisted, not a generic message."""
    cursor = Mock()
    cursor.fetchone.side_effect = [
        (42, 1, {"request_id": "req-1"}),
        None,
    ]
    monkeypatch.setattr(
        worker_queue,
        "process_message",
        Mock(side_effect=UnrecoverableError("ffprobe failed to read video: bad atom")),
    )
    fake_db = Mock()
    monkeypatch.setattr(worker_queue, "Supabase", Mock(return_value=fake_db))
    worker_queue.set_running(True)

    worker_queue.drain_queue(
        cursor,
        heartbeat_factory=lambda **_kwargs: nullcontext(),
    )

    fake_db.mark_media_processing_failed.assert_called_once_with(
        "ffprobe failed to read video: bad atom"
    )


@pytest.mark.unit
def test_exhausted_retries_are_archived_and_marked_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A message that outlives MAX_RETRIES must be archived and the request
    flagged as permanently failed, without ever calling process_message again.
    """
    from config.settings import MAX_RETRIES

    cursor = Mock()
    cursor.fetchone.side_effect = [
        (42, MAX_RETRIES + 1, {"request_id": "req-1"}),
        None,
    ]
    process_message = Mock()
    monkeypatch.setattr(worker_queue, "process_message", process_message)
    fake_db = Mock()
    monkeypatch.setattr(worker_queue, "Supabase", Mock(return_value=fake_db))
    worker_queue.set_running(True)

    processed = worker_queue.drain_queue(
        cursor,
        heartbeat_factory=lambda **_kwargs: nullcontext(),
    )

    assert processed == 0
    process_message.assert_not_called()
    fake_db.mark_media_processing_exhausted.assert_called_once()
    cursor.execute.assert_any_call("SELECT pgmq.archive(%s, %s);", ("jobs", 42))


@pytest.mark.unit
def test_transient_failure_records_the_error_without_ending_the_retry_cycle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A retry-worthy failure must persist the real error but leave status alone."""
    cursor = Mock()
    cursor.fetchone.side_effect = [
        (42, 1, {"request_id": "req-1"}),
        None,
    ]
    monkeypatch.setattr(
        worker_queue, "process_message", Mock(side_effect=RuntimeError("storage 503"))
    )
    fake_db = Mock()
    monkeypatch.setattr(worker_queue, "Supabase", Mock(return_value=fake_db))
    worker_queue.set_running(True)

    worker_queue.drain_queue(
        cursor,
        heartbeat_factory=lambda **_kwargs: nullcontext(),
    )

    fake_db.record_media_processing_error.assert_called_once_with("storage 503")
    fake_db.mark_media_processing_failed.assert_not_called()
    fake_db.mark_media_processing_exhausted.assert_not_called()
