"""Unit tests for source download and timing inspection."""

import json
import os
from types import SimpleNamespace

import pytest

# Worker settings require the database identity even though preprocessing does
# not connect to it in these isolated tests.
os.environ.setdefault("DATABASE_URL", "mock_db")

from analyzer.video_preprocessor import VideoPreprocessor

pytestmark = pytest.mark.unit


class _DownloadResponse:
    """Small streaming response double for a successful Storage download."""

    status_code = 200

    def iter_content(self, chunk_size):
        """Yield media bytes using the same interface as requests."""
        yield b"video-bytes"

    def raise_for_status(self):
        """A successful response has no HTTP error to raise."""


def test_prepare_prefers_presentation_timestamps(monkeypatch, tmp_path):
    """Presentation timestamps are the authoritative timing source when present."""
    payload = SimpleNamespace(
        request_id="11111111-1111-1111-1111-111111111111",
        ad_creative_id="22222222-2222-2222-2222-222222222222",
        ocr_run_id="33333333-3333-3333-3333-333333333333",
        bucket="videos",
        video_path="creative.mp4",
    )
    probe = {
        "format": {"duration": "2.0", "size": "11"},
        "streams": [
            {
                "codec_type": "video",
                "width": 640,
                "height": 360,
                "avg_frame_rate": "0/0",
                "r_frame_rate": "0/0",
            }
        ],
        "frames": [
            {"best_effort_timestamp_time": "0.0"},
            {"best_effort_timestamp_time": "0.8"},
            {"best_effort_timestamp_time": "1.9"},
        ],
    }

    observed_command = {}
    monkeypatch.setattr(
        "analyzer.video_preprocessor.SUPABASE_URL",
        "https://project.example",
    )
    monkeypatch.setattr(
        "analyzer.video_preprocessor.SUPABASE_SERVICE_ROLE_KEY",
        "secret",
    )
    monkeypatch.setattr(
        "analyzer.video_preprocessor.requests.get",
        lambda *args, **kwargs: _DownloadResponse(),
    )
    def run_probe(command, **kwargs):
        """Capture the command so the test proves ffprobe emits frame records."""
        observed_command["value"] = command
        return SimpleNamespace(returncode=0, stdout=json.dumps(probe), stderr="")

    monkeypatch.setattr("analyzer.video_preprocessor.subprocess.run", run_probe)

    artifacts = VideoPreprocessor(payload, str(tmp_path)).prepare()

    assert artifacts.timing_source == "presentation_timestamps"
    assert artifacts.frame_timestamps == (0.0, 0.8, 1.9)
    assert artifacts.fps is None
    assert artifacts.width == 640
    assert artifacts.ad_creative_id == payload.ad_creative_id
    assert "-show_frames" in observed_command["value"]


def test_prepare_records_valid_constant_frame_rate_fallback(monkeypatch, tmp_path):
    """Frame-index timing is allowed only for an explicitly constant frame rate."""
    payload = SimpleNamespace(
        request_id="11111111-1111-1111-1111-111111111111",
        ad_creative_id="22222222-2222-2222-2222-222222222222",
        ocr_run_id="33333333-3333-3333-3333-333333333333",
        bucket="videos",
        video_path="creative.mp4",
    )
    probe = {
        "format": {"duration": "2.0", "size": "11"},
        "streams": [
            {
                "codec_type": "video",
                "width": 640,
                "height": 360,
                "avg_frame_rate": "30/1",
                "r_frame_rate": "30/1",
            }
        ],
        "frames": [
            {"pkt_duration_time": "0.033333"},
            {"pkt_duration_time": "0.033333"},
        ],
    }

    monkeypatch.setattr(
        "analyzer.video_preprocessor.SUPABASE_URL",
        "https://project.example",
    )
    monkeypatch.setattr(
        "analyzer.video_preprocessor.SUPABASE_SERVICE_ROLE_KEY",
        "secret",
    )
    monkeypatch.setattr(
        "analyzer.video_preprocessor.requests.get",
        lambda *args, **kwargs: _DownloadResponse(),
    )
    monkeypatch.setattr(
        "analyzer.video_preprocessor.subprocess.run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout=json.dumps(probe),
            stderr="",
        ),
    )

    artifacts = VideoPreprocessor(payload, str(tmp_path)).prepare()

    assert artifacts.timing_source == "constant_frame_rate"
    assert artifacts.frame_timestamps == ()
    assert artifacts.fps == 30.0
