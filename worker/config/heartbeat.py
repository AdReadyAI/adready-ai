import threading
from .connection import connect
from .settings import logger, QUEUE_NAME, VISIBILITY_TIMEOUT, HEARTBEAT_INTERVAL

class HeartBeat:
    def __init__(self, msg_id: str):
        self.msg_id = msg_id
        self.stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        conn = connect()
        cur = conn.cursor()

        try:
            while not self._stop.wait(HEARTBEAT_INTERVAL):
                try:
                    cur.execute(
                        "SELECT pgnq.set_vt(%s, %s, %s);",
                        (QUEUE_NAME, self.msg_id, VISIBILITY_TIMEOUT),
                    )
                except:
                    logger.warning("[job %s] heartbeat failed: %s", self.msg_id, e)
        finally:
            cur.close()
            conn.close()

    def __enter__(self):
        self.thread.start()
        return self
    
    def __exit__(self):
        self._stop.set()
        self._thread.join(timeout=5)
        return False