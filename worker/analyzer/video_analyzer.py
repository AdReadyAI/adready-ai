import inspect
import os
import assemblyai as aai
import httpx

from analyzer.types import Artifacts
from config.connection import get_aai_transcriber
from config.errors import PermanentError, TransientError

from analyzer.output_models import (
    TranscriptSegment,
    TranscriptionResult,
    ObjectDetectionResult,
    ContextResult,
    OcrResult
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

        
        self.transcriber = get_aai_transcriber()

    @analysis_task("transcription")
    def transcribe(self) -> TranscriptionResult: 


        if not os.path.exists(self.artifacts.audio_path):
            raise PermanentError(f"Audio file not found: {self.artifacts.audio_path}")

        try:
            config = aai.TranscriptionConfig(speaker_labels=True, punctuate=True)
            

            transcript = self.transcriber.transcribe(self.artifacts.audio_path, config)


            if transcript.status == aai.TranscriptStatus.error:
                raise PermanentError(f"AssemblyAI processing failed: {transcript.error}")


            segments = [
                TranscriptSegment(
                    segment_id=f"tr_{idx:03d}",
                    start_ms=int(utterance.start),
                    end_ms=int(utterance.end),
                    text=utterance.text,
                    speaker=f"Speaker {utterance.speaker}"
                ) for idx, utterance in enumerate(transcript.utterances)
            ]

           
            return TranscriptionResult(
                rows=segments
            )
        except aai.AssemblyAIError as e:
            status_code = getattr(e, "status_code", None) or 0
            if status_code == 429 or status_code >= 500:
                raise TransientError(f"AssemblyAI transient error ({status_code}): {e}")
            raise PermanentError(f"AssemblyAI API request error ({status_code}): {e}")


        except httpx.TimeoutException:
            raise TransientError("AssemblyAI request timed out")
        except httpx.TransportError as e:
            raise TransientError(f"Network failure connecting to AssemblyAI: {e}")

        except Exception as e:
            raise PermanentError(f"Unexpected error in transcribe: {e}")

   
        

    @analysis_task("ocr")
    def ocr(self) -> OcrResult:
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
