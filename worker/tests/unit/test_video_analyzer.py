import unittest
from unittest.mock import MagicMock, patch

import assemblyai as aai
import httpx
import numpy as np
import pytest

import analyzer.fixed_rate_ocr_pipeline as ocr_pipeline
import analyzer.video_analyzer as video_analyzer
from analyzer.frame_sampling.probes.text import TextProbeResult, TextSegment
from analyzer.ocr_recognition import (
    DeterministicOcrAdapter,
    DeterministicOcrObservation,
)
from analyzer.video_analyzer import VideoAnalyzer
from analyzer.types import Artifacts, VideoMetadata
# from analyzer.output_models import TranscriptSegment
from app.errors import PermanentError, TransientError

pytestmark = pytest.mark.unit


class _FakeCapture:
    """Provide deterministic source frames at the OpenCV decoder seam."""

    def __init__(self, frames):
        self._frames = iter(frames)

    def isOpened(self):
        """Report that the synthetic Ad Creative opened successfully."""
        return True

    def read(self):
        """Return each source frame once, then signal end of stream."""
        try:
            return True, next(self._frames)
        except StopIteration:
            return False, None

    def release(self):
        """Release the synthetic decoder without external resources."""

class TestVideoAnalyzer(unittest.TestCase):
    def setUp(self):
        self.mock_artifacts = MagicMock(spec=Artifacts)
        self.mock_artifacts.audio_path = "/tmp/fake_audio.mp3"
        
        self.mock_transcriber = MagicMock()

    
    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_success(self, mock_exists, mock_get_transcriber):

        mock_get_transcriber.return_value = self.mock_transcriber
        
        mock_transcript = MagicMock()
        mock_transcript.status = aai.TranscriptStatus.completed
         
        mock_transcript.utterances = [
            MagicMock(start=0, end=1000, text="Hello", speaker="A"),
            MagicMock(start=1000, end=2000, text="Hi", speaker="B"),
        ]
        
        self.mock_transcriber.transcribe.return_value = mock_transcript

        analyzer = VideoAnalyzer(self.mock_artifacts)
        result = analyzer.transcribe()

        
        self.assertEqual(len(result.rows), 2)
        self.assertEqual(result.rows[0].text, "Hello")
        self.assertEqual(result.rows[0].speaker, "Speaker A")
        self.mock_transcriber.transcribe.assert_called_once()

        
    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_429(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber
        
        error = aai.AssemblyAIError("Rate limit exceeded")
        error.status_code = 429
        self.mock_transcriber.transcribe.side_effect = error

        analyzer = VideoAnalyzer(self.mock_artifacts)
        with self.assertRaises(TransientError):
            analyzer.transcribe()


    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_500(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber

        error = aai.AssemblyAIError("Internal server error")
        error.status_code = 500
        self.mock_transcriber.transcribe.side_effect = error

        analyzer = VideoAnalyzer(self.mock_artifacts)

        with self.assertRaises(TransientError):
            analyzer.transcribe()




    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_400(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber

        error = aai.AssemblyAIError("Bad request")
        error.status_code = 400
        self.mock_transcriber.transcribe.side_effect = error

        analyzer = VideoAnalyzer(self.mock_artifacts)

        with self.assertRaises(PermanentError):
            analyzer.transcribe()





    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_without_status_code(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber

        error = aai.AssemblyAIError("Unknown error")
        self.mock_transcriber.transcribe.side_effect = error

        analyzer = VideoAnalyzer(self.mock_artifacts)

        with self.assertRaises(PermanentError):
            analyzer.transcribe()




    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_processing_error(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber
        
        mock_transcript = MagicMock()
        mock_transcript.status = aai.TranscriptStatus.error
        mock_transcript.error = "File too large"
        self.mock_transcriber.transcribe.return_value = mock_transcript

        analyzer = VideoAnalyzer(self.mock_artifacts)
        with self.assertRaises(PermanentError):
            analyzer.transcribe()

    @patch("analyzer.video_analyzer.get_aai_transcriber") 
    @patch("os.path.exists", return_value=False)
    def test_transcribe_file_not_found(self, mock_exists, mock_get_transcriber): 
        mock_get_transcriber.return_value = self.mock_transcriber
        analyzer = VideoAnalyzer(self.mock_artifacts)
        with self.assertRaises(PermanentError):
            analyzer.transcribe()

    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_unexpected_error(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber
        self.mock_transcriber.transcribe.side_effect = Exception("Boom")
        
        analyzer = VideoAnalyzer(self.mock_artifacts)
        with self.assertRaises(PermanentError):
            analyzer.transcribe()



    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_empty_utterances(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber

        transcript = MagicMock()
        transcript.status = aai.TranscriptStatus.completed
        transcript.utterances = []

        self.mock_transcriber.transcribe.return_value = transcript

        analyzer = VideoAnalyzer(self.mock_artifacts)
        result = analyzer.transcribe()

        self.assertEqual(result.rows, [])



    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_transport_error(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber

        self.mock_transcriber.transcribe.side_effect = httpx.TransportError("network")

        analyzer = VideoAnalyzer(self.mock_artifacts)

        with self.assertRaises(TransientError):
            analyzer.transcribe()




    @patch("analyzer.video_analyzer.get_aai_transcriber")
    @patch("os.path.exists", return_value=True)
    def test_transcribe_timeout(self, mock_exists, mock_get_transcriber):
        mock_get_transcriber.return_value = self.mock_transcriber

        self.mock_transcriber.transcribe.side_effect = httpx.TimeoutException("timeout")

        analyzer = VideoAnalyzer(self.mock_artifacts)

        with self.assertRaises(TransientError):
            analyzer.transcribe()


def test_ocr_runs_fixed_pipeline_with_optional_text_segments(
    tmp_path,
    monkeypatch,
):
    """The OCR task independently recognizes frames with detector provenance."""
    monkeypatch.setattr(
        video_analyzer,
        "get_aai_transcriber",
        lambda: object(),
    )
    monkeypatch.setattr(
        ocr_pipeline.cv2,
        "VideoCapture",
        lambda video_path: _FakeCapture(
            (
                np.zeros((100, 200, 3), dtype=np.uint8),
                np.ones((100, 200, 3), dtype=np.uint8),
            )
        ),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.25,
        duration_s=0.25,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.8,
        representative_frame_index=0,
        candidate_sources=("periodic",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )
    artifacts = Artifacts(
        job_id="request-1",
        storage_ref="uploads/review/creative.mp4",
        video_path="synthetic.mp4",
        audio_path="synthetic.wav",
        frames=(),
        video_metadata=VideoMetadata(
            duration_s=0.3,
            fps=4.0,
            width=200,
            height=100,
            size_bytes=1_000,
        ),
        work_dir=str(tmp_path),
        probe_results={
            "text": TextProbeResult(text_segments=[text_segment]),
        },
    )
    adapter = DeterministicOcrAdapter(
        observations_by_frame={
            index: (
                DeterministicOcrObservation(
                    text="SALE",
                    rectangle_pixels=(20, 10, 80, 20),
                    confidence=0.9,
                ),
            )
            for index in (0, 1)
        }
    )

    result = VideoAnalyzer(artifacts, ocr_adapter=adapter).ocr()

    assert [segment.text for segment in result.segments] == ["SALE"]
    assert result.segments[0].source_text_segment_ids == (
        "text_segment_0001",
    )








if __name__ == "__main__":
    unittest.main()
