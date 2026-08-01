import inspect
import os
import assemblyai as aai
import httpx

from analyzer.types import Artifacts, Frame
from analyzer import detection_heuristics as dh
from analyzer.object_detector import Detection, ReferenceDetector
from config.connection import get_aai_transcriber
from config.settings import LOGO_DETECTION_LOW_CONFIDENCE, PRODUCT_DETECTION_CONFIDENCE
from app.errors import PermanentError, TransientError

from analyzer.output_models import (
    TranscriptSegment,
    TranscriptionResult,
    LogoFrameResult,
    LogoFrameRow,
    ProductFrameResult,
    ProductFrameRow,
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

    @analysis_task("product_detection")
    def detect_product(self) -> ProductFrameResult:
        rows = self._detect_reference_frames(
            tag="product",
            reference_paths=self.artifacts.product_image_paths,
            confidence=PRODUCT_DETECTION_CONFIDENCE,
            row_builder=self._product_row,
        )
        return ProductFrameResult(rows=rows)

    @analysis_task("logo_detection")
    def detect_logo(self) -> LogoFrameResult:
        rows = self._detect_reference_frames(
            tag="logo",
            reference_paths=self.artifacts.logo_paths,
            confidence=LOGO_DETECTION_LOW_CONFIDENCE,
            row_builder=self._logo_row,
        )
        return LogoFrameResult(rows=rows)

    def _detect_reference_frames(self, tag, reference_paths, confidence, row_builder):
        """Run OWLv2 on every candidate frame tagged `tag`; skip unconfirmed ones."""
        candidates = [frame for frame in self.artifacts.frames if tag in frame.tags]
        if not candidates or not reference_paths:
            return []

        detector = ReferenceDetector(list(reference_paths), label=tag)

        rows = []
        for frame in candidates:
            detection = detector.detect(frame.path, confidence=confidence)
            if detection is None:
                continue
            rows.append(row_builder(frame, detection))
        return rows

    @staticmethod
    def _product_row(frame: Frame, detection: Detection) -> ProductFrameRow:
        return ProductFrameRow(
            frame_id=dh.frame_id("p", frame),
            timestamp_ms=dh.timestamp_ms(frame),
            location=dh.location(detection),
            confidence_score=detection.confidence,
            prominence=dh.product_prominence(detection),
            focus_quality=dh.focus_quality(frame.path, detection),
            framing=dh.framing(detection),
        )

    @staticmethod
    def _logo_row(frame: Frame, detection: Detection) -> LogoFrameRow:
        return LogoFrameRow(
            frame_id=dh.frame_id("l", frame),
            timestamp_ms=dh.timestamp_ms(frame),
            location=dh.location(detection),
            confidence_score=detection.confidence,
            prominence=dh.logo_prominence(detection),
            reference_match=dh.reference_match_label(detection.confidence),
        )

    @analysis_task("context")
    def context(self) -> ContextResult:
        pass

  

    def analysis_tasks(self):
        return {
            method._analysis_task: method
            for _, method in inspect.getmembers(self, callable)
            if hasattr(method, "_analysis_task")
        }