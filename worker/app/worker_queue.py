from config.settings import logger, QUEUE_NAME, VISIBILITY_TIMEOUT, MAX_RETRIES, DEBUG, RETRY_BASE_DELAY
from app.errors import UnrecoverableError
from app.supabase import Supabase
from .processor import process_message
from .heartbeat import HeartBeat

running = True


def set_running(value):
    global running
    running = value


def drain_queue(cur, heartbeat_factory=HeartBeat):
    """Process available messages while keeping each delivery lease alive.

    ``heartbeat_factory`` is the database-boundary seam used by unit tests;
    production callers use :class:`HeartBeat` by default.
    """
    processed = 0
    while running:
        cur.execute(
            "SELECT msg_id, read_ct, message FROM pgmq.read(%s, %s, %s);",
            (QUEUE_NAME, VISIBILITY_TIMEOUT, 1)
        )
        row = cur.fetchone()

        if row is None or row[0] is None:
            break

        msg_id, read_ct, payload = row

        if read_ct > MAX_RETRIES:
            logger.warning("[job %s] Exceeded %d retries, archiving", msg_id, MAX_RETRIES)
            request_id = payload.get("request_id") if isinstance(payload, dict) else None
            if request_id:
                Supabase(cur, request_id).mark_media_processing_exhausted()
            cur.execute("SELECT pgmq.archive(%s, %s);", (QUEUE_NAME, msg_id))
            continue

        try:
            with heartbeat_factory(msg_id=msg_id):
                process_message(cur, msg_id, payload)
            cur.execute("SELECT pgmq.delete(%s, %s);", (QUEUE_NAME, msg_id))
            processed += 1
        except UnrecoverableError as e:
            logger.error("[job %s] Unrecoverable failure, archiving: %s", msg_id, e)
            request_id = payload.get("request_id") if isinstance(payload, dict) else None
            if request_id:
                Supabase(cur, request_id).mark_media_processing_failed(str(e))
            cur.execute("SELECT pgmq.archive(%s, %s);", (QUEUE_NAME, msg_id))
        except Exception as e:
            logger.error("[job %s] Failed (attempt %d): %s", msg_id, read_ct, e, exc_info=DEBUG)
            request_id = payload.get("request_id") if isinstance(payload, dict) else None
            if request_id:
                Supabase(cur, request_id).record_media_processing_error(str(e))
            delay = RETRY_BASE_DELAY * (2 ** (read_ct - 1))
            cur.execute("SELECT pgmq.set_vt(%s, %s, %s);", (QUEUE_NAME, msg_id, delay))

    return processed
