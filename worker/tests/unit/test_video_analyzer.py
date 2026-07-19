import io
import os
import sys
import unittest
from unittest.mock import MagicMock, patch
import httpx
from openai import APIStatusError, APITimeoutError, RateLimitError
import pytest

pytestmark = pytest.mark.unit

os.environ["DATABASE_URL"] = "mock_db"
os.environ["OPENROUTER_API_KEY"] = "mock_key"
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
)

from analyzer.video_analyzer import VideoAnalyzer
from analyzer.types import Artifacts
from app.errors import PermanentError, TransientError


@unittest.skip(
    "transcribe() is currently a stub on the saveProcessingOutput branch; "
    "see test_supabase.py / test_output_models.py for the new persistence logic."
)
class TestVideoAnalyzer(unittest.TestCase):

    def setUp(self):

        self.mock_artifacts = MagicMock(spec=Artifacts)
        self.mock_artifacts.audio_path = "/tmp/fake_audio.mp3"
        self.mock_artifacts.video_path = "/tmp/fake_video.mp4"

        self.mock_client = MagicMock()

        self.mock_response = MagicMock()
        self.mock_response.text = "Test transcription"

        self.mock_client.audio.transcriptions.create.return_value = (
            self.mock_response
        )

    def create_analyzer(self):
        with patch(
            "analyzer.video_analyzer.get_openrouter_client",
            return_value=self.mock_client,
        ):
            return VideoAnalyzer(self.mock_artifacts)

    @patch("os.path.exists", return_value=True)
    def test_transcribe_success(self, mock_exists):

        analyzer = self.create_analyzer()

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            result = analyzer.transcribe()

        self.assertEqual(result, "Test transcription")

        self.mock_client.audio.transcriptions.create.assert_called_once()

        _, kwargs = self.mock_client.audio.transcriptions.create.call_args

        self.assertEqual(
            kwargs["model"],
            "openai/whisper-large-v3",
        )

    @patch("os.path.exists", return_value=False)
    def test_transcribe_file_not_found(self, mock_exists):

        analyzer = self.create_analyzer()

        with self.assertRaises(PermanentError):
            analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_rate_limit(self, mock_exists):

        analyzer = self.create_analyzer()

        self.mock_client.audio.transcriptions.create.side_effect = (
            RateLimitError(
                "Too many requests",
                response=MagicMock(),
                body={},
            )
        )

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(TransientError):
                analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_timeout(self, mock_exists):

        analyzer = self.create_analyzer()

        self.mock_client.audio.transcriptions.create.side_effect = (
            APITimeoutError(request=MagicMock())
        )

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(TransientError):
                analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_500(self, mock_exists):

        analyzer = self.create_analyzer()

        request = httpx.Request(
            "POST",
            "https://openrouter.ai/api/v1/audio/transcriptions",
        )

        response = httpx.Response(
            status_code=500,
            request=request,
        )

        error = APIStatusError(
            "Internal Server Error",
            response=response,
            body={},
        )

        self.mock_client.audio.transcriptions.create.side_effect = error

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(TransientError):
                analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_400(self, mock_exists):

        analyzer = self.create_analyzer()

        request = httpx.Request(
            "POST",
            "https://openrouter.ai/api/v1/audio/transcriptions",
        )

        response = httpx.Response(
            status_code=400,
            request=request,
        )

        error = APIStatusError(
            "Bad Request",
            response=response,
            body={},
        )

        self.mock_client.audio.transcriptions.create.side_effect = error

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(PermanentError):
                analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_unexpected_error(self, mock_exists):

        analyzer = self.create_analyzer()

        self.mock_client.audio.transcriptions.create.side_effect = Exception(
            "Boom"
        )

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(PermanentError):
                analyzer.transcribe()


if __name__ == "__main__":
    unittest.main()