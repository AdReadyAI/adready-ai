import inspect
import os

from openai import OpenAI, APIError, APITimeoutError, RateLimitError

from analyzer.types import Artifacts
from config.settings import OPENROUTER_API_KEY
from app.errors import PermanentError, TransientError


def analysis_task(name: str):
    """Tag a method as an analysis task exposed via analysis_tasks()."""
    def decorator(fn):
        fn._analysis_task = name
        return fn
    return decorator


class VideoAnalyzer:
    def __init__(self, artifacts: Artifacts, client=None):
        self.artifacts = artifacts

        self.client = client or OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=OPENROUTER_API_KEY,
        )

    @analysis_task("transcription")
    def transcribe(self):

        if not os.path.exists(self.artifacts.audio_path):
            raise PermanentError(
                f"Audio file not found: {self.artifacts.audio_path}"
            )

        try:
            with open(self.artifacts.audio_path, "rb") as audio_file:
                response = self.client.audio.transcriptions.create(
                    model="openai/whisper-large-v3",
                    file=audio_file,
                )

            return response.text

        except RateLimitError as e:
            raise TransientError(f"Rate limit exceeded: {e}")

        except APITimeoutError as e:
            raise TransientError(f"Request timed out: {e}")

        except APIError as e:
            if e.status_code and e.status_code >= 500:
                raise TransientError(
                    f"OpenRouter server error ({e.status_code}): {e}"
                )

            raise PermanentError(
                f"OpenRouter request error ({e.status_code}): {e}"
            )

        except Exception as e:
            raise PermanentError(f"Unexpected error: {e}")

    @analysis_task("frame_text")
    def frame_text(self):
        pass

    @analysis_task("object_detection")
    def detect_objects(self):
        pass

    @analysis_task("context")
    def context(self):
        pass

    def analysis_tasks(self):
        return {
            method._analysis_task: method
            for _, method in inspect.getmembers(self, callable)
            if hasattr(method, "_analysis_task")
        }