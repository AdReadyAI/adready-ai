import bisect
import inspect
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import assemblyai as aai
import httpx

from analyzer.types import Artifacts, Frame
from analyzer import detection_heuristics as dh
from analyzer.object_detector import Detection, ReferenceDetector
from analyzer.visual_captioner import VisualCaptioner
from config.connection import get_aai_transcriber
from config.settings import (
    LOGO_DETECTION_LOW_CONFIDENCE,
    PRODUCT_DETECTION_CONFIDENCE,
    REFERENCE_DETECTION_MAX_WORKERS,
    VISUAL_CAPTION_MAX_WORKERS,
)
from config.settings import logger
from app.errors import PermanentError, TransientError

from analyzer.output_models import (
    TranscriptSegment,
    TranscriptionResult,
    LogoFrameResult,
    LogoFrameRow,
    ProductFrameResult,
    ProductFrameRow,
    VisualFrameResult,
    VisualFrameRow,
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
    def transcribe(self) -> TranscriptionResult | None:
        if self.artifacts.audio_path is None:
            logger.info("No audio track available; skipping transcription")
            return None

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
        with ThreadPoolExecutor(max_workers=REFERENCE_DETECTION_MAX_WORKERS) as executor:
            futures = {
                executor.submit(detector.detect, frame.path, confidence=confidence): frame
                for frame in candidates
            }
            for future in as_completed(futures):
                frame = futures[future]
                try:
                    detection = future.result()
                except TransientError:
                    logger.exception(
                        "OWLv2 request failed for frame %s, skipping this frame", frame.index
                    )
                    continue
                if detection is None:
                    continue
                rows.append(row_builder(frame, detection))

        rows.sort(key=lambda r: r.timestamp_ms)
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
    def context(self) -> VisualFrameResult:
        keyframes = [f for f in self.artifacts.frames if "keyframe" in f.tags]
        if not keyframes:
            return VisualFrameResult(rows=[])

        scene_result = self.artifacts.probe_results.get("scene")
        shots = scene_result.shots if scene_result else []
        fps = self.artifacts.video_metadata.fps or 0.0

        shot_starts = [s.start_index for s in shots]
        fade_indices = {round(f * fps) for f in (scene_result.fades if scene_result else [])}
        shot_has_fade = [
            any(idx in fade_indices for idx in range(s.start_index, s.end_index + 1))
            for s in shots
        ]

        def shot_info(frame_index: int) -> tuple[int | None, bool, bool]:
            """Returns (shot_index, is_shot_start, is_fade) for one frame index."""
            i = bisect.bisect_right(shot_starts, frame_index) - 1
            if i < 0 or not (shots[i].start_index <= frame_index <= shots[i].end_index):
                return None, False, False
            return i, frame_index == shots[i].start_index, shot_has_fade[i]

        captioner = VisualCaptioner()
        with ThreadPoolExecutor(max_workers=VISUAL_CAPTION_MAX_WORKERS) as executor:
            futures = {
                executor.submit(
                    captioner.caption, frame.path, is_shot_start=shot_info(frame.index)[1]
                ): frame
                for frame in keyframes
            }
            rows = []
            for future in as_completed(futures):
                frame = futures[future]
                shot_index, is_shot_start, is_fade = shot_info(frame.index)
                try:
                    caption = future.result()
                except (TransientError, PermanentError):
                    logger.exception(
                        "Captioning failed for frame %s, keeping row with empty caption fields",
                        frame.index,
                    )
                    rows.append(VisualFrameRow(
                        frame_id=dh.frame_id("v", frame),
                        timestamp_ms=dh.timestamp_ms(frame),
                        image_url=None,
                        action=None,
                        framing_composition=None,
                        people=None,
                        color_palette=None,
                        background=None,
                        technical_flags=[],
                        shot_index=shot_index,
                        is_shot_start=is_shot_start,
                        is_fade=is_fade,
                    ))
                    continue
                rows.append(VisualFrameRow(
                    frame_id=dh.frame_id("v", frame),
                    timestamp_ms=dh.timestamp_ms(frame),
                    image_url=None,
                    action=caption.action,
                    framing_composition=caption.framing_composition,
                    people=caption.people,
                    color_palette=caption.color_palette,
                    background=caption.background,
                    technical_flags=caption.technical_flags,
                    shot_index=shot_index,
                    is_shot_start=is_shot_start,
                    is_fade=is_fade,
                ))

        rows.sort(key=lambda r: r.timestamp_ms)
        return VisualFrameResult(rows=rows)

    def analysis_tasks(self):
        return {
            method._analysis_task: method
            for _, method in inspect.getmembers(self, callable)
            if hasattr(method, "_analysis_task")
        }