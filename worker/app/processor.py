import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import random
import time

from config.settings import logger
from analyzer.video_preprocessor import VideoPreprocessor
from analyzer.video_analyzer import VideoAnalyzer
from app.schemas import JobPayload
from app.errors import TransientError
from config.settings import ANALYSIS_TASK_MAX_RETRIES



def process_message(msg_id, payload):
    logger.info("[job %s] Processing: %s", msg_id, payload)
    with tempfile.TemporaryDirectory(prefix=f"job_{msg_id}_") as work_dir:
        payload = _parse_payload(msg_id, payload)

        preprocessor = VideoPreprocessor(payload.request_id, work_dir)
        artifact = preprocessor.prepare()

        analyzer = VideoAnalyzer(artifact)
        results, errors = _run_analysis(analyzer)

        _persist_results(payload.request_id, results, errors)
        if errors:
            raise RuntimeError(f"[job {msg_id}] analyzers failed: {list(errors)}")
    
    logger.info("[job %s] Done", msg_id)





def _parse_payload(msg_id, payload: dict) -> JobPayload:
    try:
        return JobPayload.model_validate(payload) 
    except (KeyError, TypeError) as e:
        raise ValueError(f"invalid job {msg_id} payload: {e}")


def _run_analysis(request_id: str, analyzer: VideoAnalyzer) -> tuple[dict, dict]:
    done = _completed_analyzers(request_id)
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

def _with_retry(fn, attempts=ANALYSIS_TASK_MAX_RETRIES, base=1.0):
    last = None
    for i in range(attempts):
        try:
            return fn()
        except TransientError as e:
            last = e
            sleep = base * (2 ** i) + random.uniform(0, 0.5)
            time.sleep(sleep)
    raise last

def _completed_analyzers(cur, request_id) -> set[str]:
    #TODO: check the completed analysis tasks from the analysis_results table 
    # (not sure yet about it)
    pass


def _persist_results(request_id: str, results, errors):
    pass