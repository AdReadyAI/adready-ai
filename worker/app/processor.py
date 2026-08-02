import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import random
import time

from config.settings import logger
from analyzer.video_preprocessor import VideoPreprocessor
from analyzer.video_analyzer import VideoAnalyzer
from app.log_utils import phase
from app.schemas import JobPayload
from app.errors import TransientError
from config.settings import ANALYSIS_TASK_MAX_ATTEMPTS
from analyzer.output_models import TaskResult
from app.supabase import Supabase



def process_message(cur, msg_id, payload):
    payload = _parse_payload(msg_id, payload)
    request_id = payload.request_id

    job_start = time.perf_counter()
    logger.info("[job %s] Processing: %s", msg_id, request_id)
    with tempfile.TemporaryDirectory(prefix=f"job_{msg_id}_") as work_dir:
        preprocessor = VideoPreprocessor(payload, work_dir)
        with phase(logger, f"[job {msg_id}] Preprocessing"):
            artifact = preprocessor.prepare()

        analyzer = VideoAnalyzer(artifact)
        db = Supabase(cur=cur, request_id=request_id)

        quality_result = artifact.probe_results.get("quality")
        if quality_result is not None:
            try:
                db.persist_quality_frames(quality_result.flags)
            except Exception:
                logger.exception(
                    "[job %s] failed to persist quality frames", msg_id
                )

        scene_result = artifact.probe_results.get("scene")
        try:
            db.persist_video_metadata(artifact.video_metadata, scene_result)
        except Exception:
            logger.exception("[job %s] failed to persist video metadata", msg_id)

        with phase(logger, f"[job {msg_id}] Analysis"):
            results, errors = _run_analysis(db, analyzer, msg_id)

        db.persist_results(results, errors)

        if errors:
            raise RuntimeError(f"[job {msg_id}] analyzers failed: {list(errors)}")

    logger.info("[job %s] Done in %.2fs", msg_id, time.perf_counter() - job_start)


def _parse_payload(msg_id, payload: dict) -> JobPayload:
    try:
        return JobPayload.model_validate(payload) 
    except (KeyError, TypeError) as e:
        raise ValueError(f"invalid job {msg_id} payload: {e}")


def _run_analysis(
    db: Supabase, analyzer: VideoAnalyzer, msg_id=None
) -> tuple[dict[str, TaskResult], dict[str, str]]:
    done = db.completed_analyzers()
    tasks = {n: fn for n, fn in analyzer.analysis_tasks().items() if n not in done}
    logger.info("[job %s] Analysis tasks scheduled: %s", msg_id, list(tasks))

    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=max(len(tasks), 1)) as executor:
        futures = {
            executor.submit(_with_retry, fn, msg_id=msg_id): name
            for name, fn in tasks.items()
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                result = future.result()
                if result is not None:
                    results[name] = result
            except Exception as e:
                errors[name] = str(e)
    logger.info(
        "[job %s] Analysis tasks complete: %d succeeded, %d failed (%s)",
        msg_id, len(results), len(errors), list(errors),
    )
    return results, errors

def _with_retry(fn, attempts=ANALYSIS_TASK_MAX_ATTEMPTS, base=1.0, msg_id=None):
    name = getattr(fn, "_analysis_task", getattr(fn, "__name__", "task"))
    start = time.perf_counter()
    logger.info("[job %s] [task %s] started", msg_id, name)
    for i in range(attempts):
        try:
            result = fn()
            logger.info(
                "[job %s] [task %s] finished in %.2fs",
                msg_id, name, time.perf_counter() - start,
            )
            return result
        except TransientError as e:
            if i == attempts - 1:
                logger.error(
                    "[job %s] [task %s] failed after %.2fs (%d attempts): %s",
                    msg_id, name, time.perf_counter() - start, attempts, e,
                )
                raise
            sleep = base * (2 ** i) + random.uniform(0, 0.5)
            logger.warning(
                "[task %s] transient error on attempt %d/%d, retrying in %.1fs: %s",
                name, i + 1, attempts, sleep, e,
            )
            time.sleep(sleep)
        except Exception as e:
            logger.error(
                "[job %s] [task %s] failed after %.2fs: %s",
                msg_id, name, time.perf_counter() - start, e,
            )
            raise

