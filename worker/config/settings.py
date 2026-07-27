import os
import logging

DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")

logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
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
ANALYSIS_TASK_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY = 5

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")