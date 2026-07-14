import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import random
import time

from config.settings import logger
from analyzer.video_preprocessor import VideoPreprocessor
from analyzer.video_analyzer import VideoAnalyzer
from app.schemas import JobPayload
from app.errors import TransientError
from config.settings import ANALYSIS_TASK_MAX_ATTEMPTS



def process_message(cur, msg_id, payload):
    payload = _parse_payload(msg_id, payload)

    logger.info("[job %s] Processing: %s", msg_id, payload.request_id)
    with tempfile.TemporaryDirectory(prefix=f"job_{msg_id}_") as work_dir:
        

        preprocessor = VideoPreprocessor(payload.request_id, work_dir)
        artifact = preprocessor.prepare()

        analyzer = VideoAnalyzer(artifact)
        results, errors = _run_analysis(cur, payload.request_id, analyzer)

        _persist_results(payload.request_id, results, errors)
        if errors:
            raise RuntimeError(f"[job {msg_id}] analyzers failed: {list(errors)}")
    
    logger.info("[job %s] Done", msg_id)





def _parse_payload(msg_id, payload: dict) -> JobPayload:
    try:
        return JobPayload.model_validate(payload) 
    except (KeyError, TypeError) as e:
        raise ValueError(f"invalid job {msg_id} payload: {e}")


def _run_analysis(cur, request_id: str, analyzer: VideoAnalyzer) -> tuple[dict, dict]:
    done = _completed_analyzers(cur, request_id)
    tasks = {n: fn for n, fn in analyzer.analysis_tasks().items() if n not in done}

    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=max(len(tasks), 1)) as executor:
        futures = {executor.submit(_with_retry, fn): name for name, fn in tasks.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = future.result()
            except Exception as e:
                errors[name] = str(e)
    return results, errors

def _with_retry(fn, attempts=ANALYSIS_TASK_MAX_ATTEMPTS, base=1.0):
    name = getattr(fn, "_analysis_task", getattr(fn, "__name__", "task"))
    for i in range(attempts):
        try:
            return fn()
        except TransientError as e:
            if i == attempts - 1:
                raise
            sleep = base * (2 ** i) + random.uniform(0, 0.5)
            logger.warning(
                "[task %s] transient error on attempt %d/%d, retrying in %.1fs: %s",
                name, i + 1, attempts, sleep, e,
            )
            time.sleep(sleep)

def _completed_analyzers(cur, request_id) -> set[str]:
    #TODO: check the completed analysis tasks from the analysis_results table 
    # (not sure yet about it)
    return set() 


def _persist_results(request_id: str, results, errors):
    pass