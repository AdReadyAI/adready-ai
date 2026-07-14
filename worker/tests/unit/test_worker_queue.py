"""Unit tests for the worker's durable-message lifecycle."""

import os
from unittest.mock import Mock

import pytest

# Worker configuration is loaded at import time, but unit tests never connect to this URL.
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")

import app.worker_queue as worker_queue  # noqa: E402  (configuration must be initialized before this import)


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
    processed = worker_queue.drain_queue(cursor)

    assert processed == 1
    process_message.assert_called_once_with(
        cursor,
        42,
        {"review_id": "review-1"},
    )   
    cursor.execute.assert_any_call("SELECT pgmq.delete(%s, %s);", ("jobs", 42))
