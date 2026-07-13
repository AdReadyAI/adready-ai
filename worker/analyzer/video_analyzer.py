import inspect

from analyzer.types import Artifacts


def analysis_task(name: str):
    """Tag a method as an analysis task exposed via `analysis_tasks()`."""
    def decorator(fn):
        fn._analysis_task = name
        return fn
    return decorator


class VideoAnalyzer:
    def __init__(self, artifacts: Artifacts):
        self.artifacts = artifacts

    @analysis_task("transcription")
    def transcribe(self):
        pass

    @analysis_task("frame_text")
    def frame_text(self):
        pass

    @analysis_task("object_detection")
    def detect_objects(self):
        pass

    @analysis_task("context")
    def context(self):
        pass

    
    
    def analysis_tasks(self) -> dict:
        """Discover all methods tagged with @analysis_task on this instance."""
        return {
            method._analysis_task: method
            for _, method in inspect.getmembers(self, callable)
            if hasattr(method, "_analysis_task")
        }