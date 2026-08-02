import os
import time
import signal
import select
import psycopg2

from config.settings import logger, MODE, QUEUE_NAME, CHANNEL_NAME, VISIBILITY_TIMEOUT, POLL_TIMEOUT, MAX_RETRIES, WARM_MODELS
from config.connection import connect
from app.worker_queue import drain_queue, set_running
from config.models import get_east, get_mobileclip


def _maybe_start_debugpy():
    if MODE != "dev":
        return
    import debugpy

    debugpy.listen(("0.0.0.0", 5678))
    logger.info("debugpy listening on 0.0.0.0:5678, waiting for client to attach...")
    debugpy.wait_for_client()


def shutdown(signum, frame):
    logger.info("Received signal %s, shutting down gracefully...", signum)
    set_running(False)


signal.signal(signal.SIGTERM, shutdown)
signal.signal(signal.SIGINT, shutdown)


def main():
    _maybe_start_debugpy()

    logger.info("Worker starting...")
    logger.info("  Queue:    %s", QUEUE_NAME)
    logger.info("  Channel:  %s", CHANNEL_NAME)
    logger.info("  Timeout:  %ss", VISIBILITY_TIMEOUT)
    logger.info("  Retries:  %s", MAX_RETRIES)

    if WARM_MODELS:
        get_mobileclip()
        get_east()
        logger.info("Local models Loaded...")


    conn = connect()
    cur = conn.cursor()

    cur.execute(f"LISTEN {CHANNEL_NAME};")
    logger.info("Listening on channel '%s'...", CHANNEL_NAME)

    backlog = drain_queue(cur)
    if backlog:
        logger.info("Cleared %d backlog messages", backlog)

    while True:
        import app.worker_queue as worker_queue
        if not worker_queue.running:
            break

        try:
            readable, _, _ = select.select([conn], [], [], POLL_TIMEOUT)

            if readable:
                conn.poll()
                while conn.notifies:
                    conn.notifies.pop(0)

            drain_queue(cur)

        except psycopg2.OperationalError as e:
            logger.error("Connection lost: %s", e)
            logger.info("Reconnecting in 3 seconds...")
            time.sleep(3)
            try:
                conn.close()
            except Exception:
                pass
            conn = connect()
            cur = conn.cursor()
            cur.execute(f"LISTEN {CHANNEL_NAME};")
            logger.info("Reconnected, resuming...")

        except Exception as e:
            logger.error("Unexpected error: %s", e)
            time.sleep(1)

    cur.close()
    conn.close()
    logger.info("Worker stopped")


if __name__ == "__main__":
    main()