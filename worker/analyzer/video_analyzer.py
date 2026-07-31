import inspect
import os
import assemblyai as aai
import httpx

from analyzer.ocr.pipeline import (
    FixedRateOcrAnalysis,
    FixedRateOcrPipeline,
)
from analyzer.frame_sampling.probes.text import TextProbeResult
from analyzer.ocr.routing import OcrCandidateMode
from analyzer.ocr.recognition import OcrAdapter
from analyzer.types import Artifacts
from config.connection import get_aai_transcriber
from app.errors import PermanentError, TransientError

from analyzer.output_models import (
    TranscriptSegment,
    TranscriptionResult,
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
    def __init__(
        self,
        artifacts: Artifacts,
        ocr_adapter: OcrAdapter | None = None,
        ocr_candidate_mode: OcrCandidateMode = OcrCandidateMode.FIXED_4FPS,
    ):
        self.artifacts = artifacts
        self.ocr_adapter = ocr_adapter
        self.ocr_candidate_mode = ocr_candidate_mode
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
    def ocr(self) -> FixedRateOcrAnalysis | None:
        """Run independent fixed-rate OCR when an adapter is configured."""
        if self.ocr_adapter is None:
            # Ticket #6 supplies the production hosted adapter. Until then,
            # leaving the result empty keeps the durable OCR Run resumable.
            return None

        text_result = self.artifacts.probe_results.get("text")
        text_segments = (
            tuple(text_result.text_segments)
            if isinstance(text_result, TextProbeResult)
            else ()
        )
        cascade_failure_reason = (
            "text_detection_unavailable"
            if (
                self.ocr_candidate_mode is not OcrCandidateMode.FIXED_4FPS
                and not isinstance(text_result, TextProbeResult)
            )
            else None
        )
        return FixedRateOcrPipeline(
            self.ocr_adapter,
            requested_mode=self.ocr_candidate_mode,
        ).run(
            video_path=self.artifacts.video_path,
            metadata=self.artifacts.video_metadata,
            work_dir=self.artifacts.work_dir,
            text_segments=text_segments,
            cascade_failure_reason=cascade_failure_reason,
        )


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
