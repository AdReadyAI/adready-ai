import threading
from config.connection import connect
from config.settings import logger, QUEUE_NAME, VISIBILITY_TIMEOUT, HEARTBEAT_INTERVAL

class HeartBeat:
    def __init__(self, msg_id: str):
        self.msg_id = msg_id
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        conn = connect()
        cur = conn.cursor()

        try:
            while not self._stop.wait(HEARTBEAT_INTERVAL):
                try:
                    cur.execute(
                        "SELECT pgmq.set_vt(%s, %s, %s);",
                        (QUEUE_NAME, self.msg_id, VISIBILITY_TIMEOUT),
                    )
                except Exception as e:
                    logger.warning("[job %s] heartbeat failed: %s", self.msg_id, e)
        finally:
            cur.close()
            conn.close()

    def __enter__(self):
        self._thread.start()
        return self
    
    def __exit__(self, exc_type, exc, tb):
        self._stop.set()
        self._thread.join(timeout=5)
        return False