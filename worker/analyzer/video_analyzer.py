import inspect

from analyzer.types import Artifacts
from config.connection import get_openrouter_client
from app.errors import PermanentError, TransientError
from analyzer.output_models import (
    TranscriptionResult,
    FrameTextResult,
    ObjectDetectionResult,
    ContextResult,
)


def analysis_task(name: str):
    """Tag a method as an analysis task exposed via analysis_tasks()."""
    def decorator(fn):
        fn._analysis_task = name
        return fn
    return decorator


class VideoAnalyzer:
    def __init__(self, artifacts: Artifacts):
        self.artifacts = artifacts
        self.client = get_openrouter_client()

    @analysis_task("transcription")
    def transcribe(self) -> TranscriptionResult:
        pass

    @analysis_task("frame_text")
    def frame_text(self) -> FrameTextResult:
        pass

    @analysis_task("object_detection")
    def detect_objects(self) -> ObjectDetectionResult:
        pass

    @analysis_task("context")
    def context(self) -> ContextResult:
        pass

    def analysis_tasks(self):
        return {
            method._analysis_task: method
            for _, method in inspect.getmembers(self, callable)
            if hasattr(method, "_analysis_task")
        }