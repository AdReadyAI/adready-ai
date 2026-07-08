import logging
import time

logger = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logger.info("media worker started")

    # Placeholder process loop. Replace with durable task claiming once the
    # review_tasks contract is defined.
    while True:
        time.sleep(30)
