import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import random
import time

from config.connection import get_storage_session
from config.settings import logger
from analyzer.video_preprocessor import VideoPreprocessor
from analyzer.video_analyzer import VideoAnalyzer
from app.schemas import JobPayload
from app.errors import TransientError
from config.settings import ANALYSIS_TASK_MAX_ATTEMPTS, SUPABASE_URL
from analyzer.output_models import TaskResult
from analyzer.ocr.completion import OcrCompletionCoordinator
from analyzer.ocr.configuration import OcrRuntimeConfig
from analyzer.ocr.frame_artifacts import SupabaseOcrFrameArtifactStore
from analyzer.ocr.roboflow import build_roboflow_easyocr_adapter_from_env
from app.ocr_runs import OcrRunLifecycle
from app.supabase import Supabase


def _build_ocr_adapter():
    """Return hosted OCR only when its complete local configuration is present."""
    return build_roboflow_easyocr_adapter_from_env()


def _build_ocr_completion_coordinator(
    configuration: OcrRuntimeConfig,
):
    """Return OCR completion backed by private durable frame evidence."""
    return OcrCompletionCoordinator(
        artifact_store=SupabaseOcrFrameArtifactStore(
            supabase_url=SUPABASE_URL,
            bucket=configuration.evidence_bucket,
            session=get_storage_session(),
            timeout_seconds=(
                configuration.evidence_storage_timeout_seconds
            ),
        )
    )



def process_message(cur, msg_id, payload):
    payload = _parse_payload(msg_id, payload)
    ocr_configuration = OcrRuntimeConfig.from_env()
    request_id = payload.request_id

    logger.info("[job %s] Processing: %s", msg_id, request_id)
    with tempfile.TemporaryDirectory(prefix=f"job_{msg_id}_") as work_dir:
        preprocessor = VideoPreprocessor(payload, work_dir)
        artifact = preprocessor.prepare()

        analyzer = VideoAnalyzer(
            artifact,
            ocr_adapter=_build_ocr_adapter(),
            ocr_candidate_mode=ocr_configuration.candidate_mode,
        )
        db = Supabase(cur=cur, request_id=request_id)
        ocr_lifecycle = OcrRunLifecycle(
            cur=cur,
            request_id=request_id,
            source_bucket=payload.bucket,
            source_path=payload.video_path,
            completion_coordinator=_build_ocr_completion_coordinator(
                ocr_configuration
            ),
        )
        analyzer = _OcrLifecycleAnalyzer(
            analyzer,
            ocr_lifecycle,
            artifact.video_metadata,
        )
        results, errors = _run_analysis(db, analyzer)

        db.persist_results(results, errors)

        if errors:
            raise RuntimeError(f"[job {msg_id}] analyzers failed: {list(errors)}")
    
    logger.info("[job %s] Done", msg_id)


def _parse_payload(msg_id, payload: dict) -> JobPayload:
    try:
        return JobPayload.model_validate(payload) 
    except (KeyError, TypeError) as e:
        raise ValueError(f"invalid job {msg_id} payload: {e}")


class _OcrLifecycleAnalyzer:
    """Apply durable lifecycle to OCR while preserving the analyzer registry."""

    def __init__(self, analyzer, lifecycle, video_metadata):
        self.analyzer = analyzer
        self.lifecycle = lifecycle
        self.video_metadata = video_metadata

    def analysis_tasks(self):
        """Return the existing registry with only its OCR callable wrapped."""
        tasks = self.analyzer.analysis_tasks()
        run_ocr_analysis = tasks.get("ocr")
        if run_ocr_analysis is None:
            return tasks

        def run_ocr():
            """Execute registered OCR through its durable lifecycle boundary."""
            self.lifecycle.execute(run_ocr_analysis, self.video_metadata)
            return None

        # Preserve the task identity used by the existing retry logger.
        run_ocr._analysis_task = "ocr"
        return {**tasks, "ocr": run_ocr}


def _run_analysis(db: Supabase, analyzer: VideoAnalyzer) -> tuple[dict[str, TaskResult], dict[str, str]]:
    done = db.completed_analyzers()
    tasks = {n: fn for n, fn in analyzer.analysis_tasks().items() if n not in done}

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
