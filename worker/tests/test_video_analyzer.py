import io
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from openai import APIError, APITimeoutError, RateLimitError

os.environ["DATABASE_URL"] = "mock_db"
os.environ["OPENROUTER_API_KEY"] = "mock_key"

sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
)

from analyzer.video_analyzer import VideoAnalyzer
from analyzer.types import Artifacts
from app.errors import PermanentError, TransientError


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

        self.analyzer = VideoAnalyzer(
            self.mock_artifacts,
            client=self.mock_client,
        )

    @patch("os.path.exists", return_value=True)
    def test_transcribe_success(self, mock_exists):

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):

            result = self.analyzer.transcribe()

        self.assertEqual(result, "Test transcription")

        self.mock_client.audio.transcriptions.create.assert_called_once()

        # Vérifie également les arguments passés au SDK
        _, kwargs = self.mock_client.audio.transcriptions.create.call_args

        self.assertEqual(
            kwargs["model"],
            "openai/whisper-large-v3",
        )

    @patch("os.path.exists", return_value=False)
    def test_transcribe_file_not_found(self, mock_exists):

        with self.assertRaises(PermanentError):
            self.analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_rate_limit(self, mock_exists):

        self.mock_client.audio.transcriptions.create.side_effect = (
            RateLimitError(
                "Too many requests",
                response=MagicMock(),
                body={}
            )
        )

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(TransientError):
                self.analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_timeout(self, mock_exists):

        self.mock_client.audio.transcriptions.create.side_effect = (
            APITimeoutError(request=MagicMock())
        )

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(TransientError):
                self.analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_500(self, mock_exists):

        error = APIError(
            "Internal Server Error",
            request=MagicMock(),
            body={}
        )
        error.status_code = 500

        self.mock_client.audio.transcriptions.create.side_effect = error

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(TransientError):
                self.analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_api_error_400(self, mock_exists):

        error = APIError(
            "Bad Request",
            request=MagicMock(),
            body={}
        )
        error.status_code = 400

        self.mock_client.audio.transcriptions.create.side_effect = error

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(PermanentError):
                self.analyzer.transcribe()

    @patch("os.path.exists", return_value=True)
    def test_transcribe_unexpected_error(self, mock_exists):

        self.mock_client.audio.transcriptions.create.side_effect = Exception(
            "Boom"
        )

        with patch(
            "builtins.open",
            return_value=io.BytesIO(b"fake audio"),
        ):
            with self.assertRaises(PermanentError):
                self.analyzer.transcribe()


if __name__ == "__main__":
    unittest.main()