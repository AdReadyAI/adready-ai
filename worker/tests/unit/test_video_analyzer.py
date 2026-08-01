import unittest
from unittest.mock import MagicMock, patch

import assemblyai as aai
import httpx
import pytest

from analyzer.video_analyzer import VideoAnalyzer
from analyzer.types import Artifacts
# from analyzer.output_models import TranscriptSegment
from app.errors import PermanentError, TransientError

pytestmark = pytest.mark.unit

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








if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# detect_product / detect_logo (real object detection)
# ---------------------------------------------------------------------------
import numpy as np
import cv2 as _cv2

from analyzer.object_detector import Detection
from analyzer.types import Frame, VideoMetadata


def _artifacts(frames, product_image_paths=("ref_p.jpg",), logo_paths=("ref_l.jpg",)):
    return Artifacts(
        job_id="r1",
        storage_ref="bucket/video.mp4",
        video_path="v.mp4",
        audio_path="a.wav",
        frames=tuple(frames),
        video_metadata=VideoMetadata(1.0, 30.0, 100, 100, 1),
        work_dir="/tmp",
        product_image_paths=tuple(product_image_paths),
        logo_paths=tuple(logo_paths),
    )


def _analyzer(artifacts):
    with patch("analyzer.video_analyzer.get_aai_transcriber", return_value=MagicMock()):
        return VideoAnalyzer(artifacts)


def test_detect_product_returns_empty_when_no_tagged_frames():
    frames = [Frame(index=0, timestamp=0.0, path="f0.jpg", tags=("keyframe",))]
    analyzer = _analyzer(_artifacts(frames))

    result = analyzer.detect_product()

    assert result.rows == []


def test_detect_product_returns_empty_when_no_reference_paths():
    frames = [Frame(index=0, timestamp=0.0, path="f0.jpg", tags=("product",))]
    analyzer = _analyzer(_artifacts(frames, product_image_paths=()))

    result = analyzer.detect_product()

    assert result.rows == []


def test_detect_product_skips_frames_the_detector_rejects():
    frames = [Frame(index=3, timestamp=0.1, path="/tmp/frames/000003.jpg", tags=("product",))]
    analyzer = _analyzer(_artifacts(frames))

    with patch("analyzer.video_analyzer.ReferenceDetector") as mock_cls:
        mock_cls.return_value.detect.return_value = None
        result = analyzer.detect_product()

    assert result.rows == []


def test_detect_product_builds_row_for_confirmed_detection(tmp_path):
    frame_path = tmp_path / "000003.jpg"
    _cv2.imwrite(str(frame_path), np.random.randint(0, 255, (50, 50, 3), dtype=np.uint8))
    frames = [Frame(index=3, timestamp=0.1, path=str(frame_path), tags=("product",))]
    analyzer = _analyzer(_artifacts(frames))

    detection = Detection(confidence=0.9, x=0.5, y=0.5, w=0.5, h=0.5)
    with patch("analyzer.video_analyzer.ReferenceDetector") as mock_cls:
        mock_cls.return_value.detect.return_value = detection
        result = analyzer.detect_product()

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.frame_id == "p_000003"
    assert row.timestamp_ms == 100
    assert row.confidence_score == 0.9
    assert row.prominence == "foreground_static"  # area 0.25 >= large threshold
    assert row.location == {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.5}


def test_detect_logo_matches_reference_above_high_confidence(tmp_path):
    frame_path = tmp_path / "000005.jpg"
    _cv2.imwrite(str(frame_path), np.full((50, 50, 3), 128, dtype=np.uint8))
    frames = [Frame(index=5, timestamp=0.2, path=str(frame_path), tags=("logo",))]
    analyzer = _analyzer(_artifacts(frames))

    detection = Detection(confidence=0.95, x=0.15, y=0.15, w=0.2, h=0.2)
    with patch("analyzer.video_analyzer.ReferenceDetector") as mock_cls:
        mock_cls.return_value.detect.return_value = detection
        result = analyzer.detect_logo()

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.frame_id == "l_000005"
    assert row.reference_match == "matches_reference"
    assert row.prominence == "small_corner"  # small + near a corner


def test_detect_logo_low_confidence_is_cannot_determine(tmp_path):
    frame_path = tmp_path / "000006.jpg"
    _cv2.imwrite(str(frame_path), np.full((50, 50, 3), 128, dtype=np.uint8))
    frames = [Frame(index=6, timestamp=0.2, path=str(frame_path), tags=("logo",))]
    analyzer = _analyzer(_artifacts(frames))

    detection = Detection(confidence=0.65, x=0.5, y=0.5, w=0.02, h=0.02)
    with patch("analyzer.video_analyzer.ReferenceDetector") as mock_cls:
        mock_cls.return_value.detect.return_value = detection
        result = analyzer.detect_logo()

    assert result.rows[0].reference_match == "cannot_determine"
    assert result.rows[0].prominence == "background_signage"  # small + centered