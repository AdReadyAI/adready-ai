from worker.config.config import logger


def process_message(msg_id, payload):
    logger.info("[job %s] Processing: %s", msg_id, payload)
    # TODO: Video analysis process will be trigerred from here
    logger.info("[job %s] Done", msg_id)
