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
    def test_transcribe_skips_when_no_audio_track(self, mock_get_transcriber):
        # Silent/b-roll-only videos have audio_path=None; this must be a
        # graceful skip (no result, no error), not a PermanentError.
        mock_get_transcriber.return_value = self.mock_transcriber
        self.mock_artifacts.audio_path = None

        analyzer = VideoAnalyzer(self.mock_artifacts)
        result = analyzer.transcribe()

        self.assertIsNone(result)
        self.mock_transcriber.transcribe.assert_not_called()

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


# ---------------------------------------------------------------------------
# context (visual captioning)
# ---------------------------------------------------------------------------
from analyzer.frame_sampling.probes.scene import SceneProbeResult, Shot
from analyzer.visual_captioner import VisualCaptionOutput


def _caption(action="doing something"):
    return VisualCaptionOutput(action=action)


def test_context_returns_empty_when_no_keyframes():
    frames = [Frame(index=0, timestamp=0.0, path="f0.jpg", tags=("product",))]
    analyzer = _analyzer(_artifacts(frames))

    with patch("analyzer.video_analyzer.VisualCaptioner") as mock_cls:
        result = analyzer.context()

    assert result.rows == []
    mock_cls.assert_not_called()


def test_context_builds_rows_with_shot_linkage_and_sorts_by_timestamp():
    frames = [
        Frame(index=10, timestamp=1.0, path="f10.jpg", tags=("keyframe",)),
        Frame(index=0, timestamp=0.0, path="f0.jpg", tags=("keyframe",)),
        Frame(index=5, timestamp=0.5, path="f5.jpg", tags=("keyframe",)),
    ]
    artifacts = _artifacts(frames)
    probe_results = {
        "scene": SceneProbeResult(
            shots=[
                Shot(start_s=0.0, end_s=0.4, start_index=0, end_index=4),
                Shot(start_s=0.5, end_s=2.0, start_index=5, end_index=20),
            ],
            fades=[],
        )
    }
    artifacts = Artifacts(
        **{**artifacts.__dict__, "probe_results": probe_results}
    )
    analyzer = _analyzer(artifacts)

    with patch("analyzer.video_analyzer.VisualCaptioner") as mock_cls:
        mock_cls.return_value.caption.return_value = _caption()
        result = analyzer.context()

    assert [row.frame_id for row in result.rows] == ["v_000000", "v_000005", "v_000010"]
    assert [row.timestamp_ms for row in result.rows] == [0, 500, 1000]

    by_index = {row.frame_id: row for row in result.rows}
    assert by_index["v_000000"].shot_index == 0
    assert by_index["v_000000"].is_shot_start is True
    assert by_index["v_000005"].shot_index == 1
    assert by_index["v_000005"].is_shot_start is True
    # frame 10 is mid-shot-1, not at its start (start_index=5)
    assert by_index["v_000010"].shot_index == 1
    assert by_index["v_000010"].is_shot_start is False
    assert all(row.is_fade is False for row in result.rows)
    assert all(row.action == "doing something" for row in result.rows)


def test_context_missing_scene_probe_result_defaults_shot_fields():
    frames = [Frame(index=0, timestamp=0.0, path="f0.jpg", tags=("keyframe",))]
    analyzer = _analyzer(_artifacts(frames))  # no probe_results at all

    with patch("analyzer.video_analyzer.VisualCaptioner") as mock_cls:
        mock_cls.return_value.caption.return_value = _caption()
        result = analyzer.context()

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.shot_index is None
    assert row.is_shot_start is False
    assert row.is_fade is False


def test_context_captioning_failure_keeps_row_with_empty_fields():
    frames = [
        Frame(index=0, timestamp=0.0, path="f0.jpg", tags=("keyframe",)),
        Frame(index=1, timestamp=1.0, path="f1.jpg", tags=("keyframe",)),
    ]
    analyzer = _analyzer(_artifacts(frames))

    def caption_side_effect(path, *, is_shot_start):
        if path == "f0.jpg":
            raise TransientError("boom")
        return _caption(action="ok frame")

    with patch("analyzer.video_analyzer.VisualCaptioner") as mock_cls:
        mock_cls.return_value.caption.side_effect = caption_side_effect
        result = analyzer.context()

    assert len(result.rows) == 2
    by_id = {row.frame_id: row for row in result.rows}

    failed_row = by_id["v_000000"]
    assert failed_row.action is None
    assert failed_row.framing_composition is None
    assert failed_row.people is None
    assert failed_row.color_palette is None
    assert failed_row.background is None
    assert failed_row.technical_flags == []

    ok_row = by_id["v_000001"]
    assert ok_row.action == "ok frame"