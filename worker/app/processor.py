import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
import random
import time

from config.settings import logger
from analyzer.video_preprocessor import VideoPreprocessor
from analyzer.video_analyzer import VideoAnalyzer
from config.settings import ANALYSIS_TASK_MAX_ATTEMPTS
from analyzer.output_models import TaskResult
from .errors import PermanentError, TransientError
from .schemas import JobPayload
from .supabase import Supabase


class _MediaValidationError(PermanentError):
    """Caller-safe media validation failure suitable for durable storage."""



def process_message(cur, msg_id, payload):
    payload = _parse_payload(msg_id, payload)
    request_id = payload.request_id
    db = Supabase(cur=cur, request_id=request_id)

    # The caller supplies a stable OCR Run identity. Re-delivery can therefore
    # resume the same run, while an intentional rerun uses a new identifier.
    ocr_run_status = db.create_or_resume_ocr_run(payload)
    if ocr_run_status == "completed":
        logger.info(
            "[job %s] OCR Run %s is already completed; skipping",
            msg_id,
            payload.ocr_run_id,
        )
        return

    try:
        logger.info("[job %s] Processing: %s", msg_id, request_id)
        with tempfile.TemporaryDirectory(prefix=f"job_{msg_id}_") as work_dir:
            preprocessor = VideoPreprocessor(payload, work_dir)
            artifact = preprocessor.prepare()
            _validate_media_artifacts(artifact)

            analyzer = VideoAnalyzer(artifact)
            results, errors = _run_analysis(
                db,
                analyzer,
                requested_analyses=set(payload.requested_analyses),
            )

            db.persist_results(results, errors)

            if errors:
                raise RuntimeError(
                    f"[job {msg_id}] analyzers failed: {list(errors)}"
                )
    except Exception as exc:
        # Known permanent input errors contain caller-safe validation details.
        # Unexpected failures retain only their type so source paths, signed
        # URLs, credentials, and provider payloads cannot enter durable state.
        failure = (
            str(exc)
            if isinstance(exc, _MediaValidationError)
            else f"Media Processing failed: {type(exc).__name__}"
        )
        db.fail_ocr_run(payload.ocr_run_id, failure)
        raise

    logger.info("[job %s] Done", msg_id)


def _validate_media_artifacts(artifacts) -> None:
    """Reject unsupported media before constructing any analysis provider."""

    duration_s = getattr(artifacts, "duration_s", None)
    if (
        not isinstance(duration_s, (int, float))
        or not math.isfinite(duration_s)
        or duration_s <= 0
    ):
        raise _MediaValidationError(
            "Ad Creative duration must be finite and positive"
        )
    if duration_s > 60:
        raise _MediaValidationError(
            "Ad Creative duration must not exceed 60 seconds"
        )

    timing_source = getattr(artifacts, "timing_source", None)
    timestamps = getattr(artifacts, "frame_timestamps", ())
    fps = getattr(artifacts, "fps", None)
    valid_pts = (
        timing_source == "presentation_timestamps"
        and isinstance(timestamps, tuple)
        and bool(timestamps)
    )
    valid_cfr = (
        timing_source in (None, "constant_frame_rate")
        and isinstance(fps, (int, float))
        and math.isfinite(fps)
        and fps > 0
    )
    if not valid_pts and not valid_cfr:
        raise _MediaValidationError(
            "Ad Creative requires valid presentation timestamps or positive FPS"
        )

    width = getattr(artifacts, "width", None)
    height = getattr(artifacts, "height", None)
    if (
        not isinstance(width, int)
        or isinstance(width, bool)
        or width <= 0
        or not isinstance(height, int)
        or isinstance(height, bool)
        or height <= 0
    ):
        raise _MediaValidationError(
            "Ad Creative dimensions must be positive integers"
        )


def _parse_payload(msg_id, payload: dict) -> JobPayload:
    try:
        return JobPayload.model_validate(payload) 
    except (KeyError, TypeError) as e:
        raise ValueError(f"invalid job {msg_id} payload: {e}")


def _run_analysis(
    db: Supabase,
    analyzer: VideoAnalyzer,
    requested_analyses: set[str],
) -> tuple[dict[str, TaskResult], dict[str, str]]:
    done = db.completed_analyzers()
    tasks = {
        name: task
        for name, task in analyzer.analysis_tasks().items()
        if name not in done
        and name in requested_analyses
    }

    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=max(len(tasks), 1)) as executor:
        futures = {executor.submit(_with_retry, fn): name for name, fn in tasks.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                result = future.result()
                if result is not None:
                    results[name] = result
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
