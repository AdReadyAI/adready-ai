import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
import random
import time

from config.connection import get_storage_session
from config.settings import logger
from analyzer.video_preprocessor import VideoPreprocessor
from analyzer.video_analyzer import VideoAnalyzer
from analyzer.ocr.completion import OcrCompletionCoordinator
from analyzer.ocr.configuration import OcrRuntimeConfig
from analyzer.ocr.frame_artifacts import SupabaseOcrFrameArtifactStore
from analyzer.ocr.roboflow import build_roboflow_easyocr_adapter_from_env
from app.log_utils import phase
from app.schemas import JobPayload
from app.errors import TransientError
from config.settings import ANALYSIS_TASK_MAX_ATTEMPTS, SUPABASE_URL
from analyzer.output_models import ProductContextResult, ProductContextRow, TaskResult
from app.product_context import ProductPageExtractor
from app.ocr_runs import OcrRunLifecycle
from app.supabase import Supabase


def _build_ocr_adapter():
    """Return hosted OCR only when its complete configuration is present."""
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
    db = Supabase(cur=cur, request_id=request_id)

    job_start = time.perf_counter()
    logger.info("[job %s] Processing: %s", msg_id, request_id)
    with tempfile.TemporaryDirectory(prefix=f"job_{msg_id}_") as work_dir:
        preprocessor = VideoPreprocessor(payload, work_dir)
        with phase(logger, f"[job {msg_id}] Preprocessing"):
            artifact = preprocessor.prepare()

        analyzer = VideoAnalyzer(
            artifact,
            ocr_adapter=_build_ocr_adapter(),
            ocr_candidate_mode=ocr_configuration.candidate_mode,
        )

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
        analyzer = _ProductContextAnalyzer(analyzer, payload.product_url)

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


class _OcrLifecycleAnalyzer:
    """Apply durable lifecycle to OCR while preserving the task registry."""

    def __init__(self, analyzer, lifecycle, video_metadata):
        self.analyzer = analyzer
        self.lifecycle = lifecycle
        self.video_metadata = video_metadata

    def analysis_tasks(self):
        """Return the registry with only its OCR callable wrapped."""
        tasks = self.analyzer.analysis_tasks()
        run_ocr_analysis = tasks.get("ocr")
        if run_ocr_analysis is None:
            return tasks

        def run_ocr():
            """Execute OCR through its durable lifecycle boundary."""
            self.lifecycle.execute(run_ocr_analysis, self.video_metadata)
            return None

        # Preserve the task identity used by main's retry and timing logs.
        run_ocr._analysis_task = "ocr"
        return {**tasks, "ocr": run_ocr}


class _ProductContextAnalyzer:
    """Add Product Context extraction to the shared task registry so it gets
    the same concurrent retry/error handling and result persistence as the
    other analyzer tasks, instead of blocking ahead of them.
    """

    def __init__(
        self,
        analyzer,
        product_url: str | None,
        extractor: ProductPageExtractor | None = None,
    ):
        self.analyzer = analyzer
        self.product_url = product_url
        self.extractor = extractor

    def analysis_tasks(self):
        """Return the registry with Product Context added when a URL was submitted."""
        tasks = self.analyzer.analysis_tasks()
        if self.product_url is None:
            return tasks

        def run_product_context() -> ProductContextResult:
            page_extractor = self.extractor or ProductPageExtractor()
            context = page_extractor.extract(self.product_url)
            return ProductContextResult(
                rows=[
                    ProductContextRow(
                        raw_text=context.raw_text,
                        reference_asset_urls=list(context.reference_asset_urls),
                    )
                ]
            )

        run_product_context._analysis_task = "product_context"
        return {**tasks, "product_context": run_product_context}


def _run_analysis(
    db: Supabase, analyzer: VideoAnalyzer, msg_id=None
) -> tuple[dict[str, TaskResult], dict[str, str]]:
    done = db.completed_analyzers()
    tasks = {n: fn for n, fn in analyzer.analysis_tasks().items() if n not in done}
    logger.info("[job %s] Analysis tasks scheduled: %s", msg_id, list(tasks))

    for name in tasks:
        db.mark_processing(name)

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
