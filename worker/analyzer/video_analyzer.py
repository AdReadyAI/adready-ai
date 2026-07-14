import inspect
from config.settings import OPENROUTER_API_KEY
from openai import OpenAI, APIError, APITimeoutError, RateLimitError
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
        """Transcribe audio using Whisper via OpenRouter."""



        """
        since the video_preprocessor isn't ready yet , i tested this method in a local script with a mock Artifact structure :
        
        audio_filename = "McValue.wav" 

        mock_artifacts = Artifacts(
        job_id="test_001",
        storage_ref="bucket_test",
        video_path=os.path.join(VIDEO_DIR, "video.mp4"),
        audio_path=os.path.join(AUDIO_DIR, audio_filename),
        frames=(),
        duration_s=10.0,
        fps=30.0,
        width=1920, height=1080, size_bytes=1024,
        work_dir="/tmp/test_work"
        )




        """
         
        if not os.path.exists(self.artifacts.audio_path):
            raise PermanentError(f"Audio file not found: {self.artifacts.audio_path}")

         
        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=OPENROUTER_API_KEY,
        )

        
        try:
            with open(self.artifacts.audio_path, "rb") as audio_file:
                response = client.audio.transcriptions.create(
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
                raise TransientError(f"OpenRouter server error ({e.status_code}): {e}")
            else:
                raise PermanentError(f"OpenRouter request error ({e.status_code}): {e}")
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

    
    
    def analysis_tasks(self) -> dict:
        """Discover all methods tagged with @analysis_task on this instance."""
        return {
            method._analysis_task: method
            for _, method in inspect.getmembers(self, callable)
            if hasattr(method, "_analysis_task")
        }