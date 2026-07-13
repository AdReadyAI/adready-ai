from config.settings import logger, QUEUE_NAME, VISIBILITY_TIMEOUT, MAX_RETRIES
from .processor import process_message
from .heartbeat import HeartBeat

running = True


def set_running(value):
    global running
    running = value


def drain_queue(cur):
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
            cur.execute("SELECT pgmq.archive(%s, %s);", (QUEUE_NAME, msg_id))
            continue

        try:
            with HeartBeat(msg_id=msg_id):
                process_message(msg_id, payload)
            cur.execute("SELECT pgmq.delete(%s, %s);", (QUEUE_NAME, msg_id))
            processed += 1
        except Exception as e:
            logger.error("[job %s] Failed (attempt %d): %s", msg_id, read_ct, e)

    return processed
