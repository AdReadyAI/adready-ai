import os

import httpx


os.environ["DATABASE_URL"] = "mock_db"
os.environ["OPENROUTER_API_KEY"] = "mock_key"

import unittest
from unittest.mock import MagicMock, patch
import assemblyai as aai

from analyzer.video_analyzer import VideoAnalyzer
from analyzer.types import Artifacts
# from analyzer.output_models import TranscriptSegment
from app.errors import PermanentError, TransientError


# @unittest.skip(
#     "transcribe() is currently a stub on the saveProcessingOutput branch; "
#     "see test_supabase.py / test_output_models.py for the new persistence logic."
# )

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