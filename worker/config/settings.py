import os
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("worker")

DATABASE_URL = os.environ["DATABASE_URL"]
QUEUE_NAME = os.environ.get("QUEUE_NAME", "jobs")
CHANNEL_NAME = os.environ.get("CHANNEL_NAME", "new_job")
VISIBILITY_TIMEOUT = 60
HEARTBEAT_INTERVAL = 20
POLL_TIMEOUT = 5
MAX_RETRIES = 3

