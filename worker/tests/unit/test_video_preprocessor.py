"""Unit tests for VideoPreprocessor: metadata, audio, download, orchestration."""

import json
import os
import subprocess
from unittest.mock import MagicMock

import pytest
import requests

pytestmark = pytest.mark.unit

# Configuration loads at import time; unit tests never reach these services.
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

import analyzer.video_preprocessor as vp  # noqa: E402
from analyzer.types import VideoMetadata  # noqa: E402
from app.errors import PermanentError, TransientError  # noqa: E402
from app.schemas import JobPayload  # noqa: E402


# ---- helpers ----
def _payload(video_path="dir/vid.mp4"):
    return JobPayload(
        request_id="r1",
        bucket="videos",
        video_path=video_path,
        product_imgs_folder_path="p",
        logo_imgs_folder_path="l",
    )


def _pre(tmp_path, video_path="dir/vid.mp4"):
    return vp.VideoPreprocessor(_payload(video_path), str(tmp_path))


def _ffprobe_json():
    return json.dumps(
        {
            "format": {"duration": "12.5", "size": "1048576"},
            "streams": [
                {"codec_type": "audio"},
                {
                    "codec_type": "video",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "30/1",
                },
            ],
        }
    )


class _FakeResp:
    """Minimal streaming response supporting the download's context-manager use."""

    def __init__(self, chunks=(b"data",), raise_exc=None):
        self._chunks = chunks
        self._raise = raise_exc

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        if self._raise:
            raise self._raise

    def iter_content(self, chunk_size):
        yield from self._chunks


def _http_error(code):
    resp = MagicMock()
    resp.status_code = code
    return requests.HTTPError(response=resp)


# ---- _parse_fps ----
def test_parse_fps_prefers_avg():
    assert (
        vp.VideoPreprocessor._parse_fps(
            {"avg_frame_rate": "30/1", "r_frame_rate": "60/1"}
        )
        == 30.0
    )


def test_parse_fps_ntsc():
    assert vp.VideoPreprocessor._parse_fps(
        {"avg_frame_rate": "30000/1001"}
    ) == pytest.approx(29.97, abs=0.01)


def test_parse_fps_skips_zero_and_falls_back():
    assert (
        vp.VideoPreprocessor._parse_fps(
            {"avg_frame_rate": "0/0", "r_frame_rate": "25/1"}
        )
        == 25.0
    )


def test_parse_fps_all_invalid_raises():
    with pytest.raises(PermanentError):
        vp.VideoPreprocessor._parse_fps({"avg_frame_rate": "0/0"})


# ---- _probe_metadata ----
def test_probe_metadata_success(tmp_path, monkeypatch):
    monkeypatch.setattr(
        vp.subprocess, "run", lambda *a, **k: MagicMock(stdout=_ffprobe_json())
    )
    meta = _pre(tmp_path)._probe_metadata("v.mp4")
    assert (meta.duration_s, meta.fps, meta.width, meta.height, meta.size_bytes) == (
        12.5,
        30.0,
        1920,
        1080,
        1048576,
    )


def test_probe_metadata_no_ffprobe(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(vp.subprocess, "run", boom)
    with pytest.raises(PermanentError):
        _pre(tmp_path)._probe_metadata("v.mp4")


def test_probe_metadata_timeout(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=1)

    monkeypatch.setattr(vp.subprocess, "run", boom)
    with pytest.raises(TransientError):
        _pre(tmp_path)._probe_metadata("v.mp4")


def test_probe_metadata_called_process_error(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise subprocess.CalledProcessError(returncode=1, cmd="ffprobe", stderr="bad")

    monkeypatch.setattr(vp.subprocess, "run", boom)
    with pytest.raises(PermanentError):
        _pre(tmp_path)._probe_metadata("v.mp4")


def test_probe_metadata_bad_json(tmp_path, monkeypatch):
    monkeypatch.setattr(
        vp.subprocess, "run", lambda *a, **k: MagicMock(stdout="not json")
    )
    with pytest.raises(PermanentError):
        _pre(tmp_path)._probe_metadata("v.mp4")


def test_probe_metadata_no_video_stream(tmp_path, monkeypatch):
    data = json.dumps(
        {"format": {"duration": "1", "size": "1"}, "streams": [{"codec_type": "audio"}]}
    )
    monkeypatch.setattr(vp.subprocess, "run", lambda *a, **k: MagicMock(stdout=data))
    with pytest.raises(PermanentError):
        _pre(tmp_path)._probe_metadata("v.mp4")


# ---- _extract_audio ----
def test_extract_audio_success(tmp_path, monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return MagicMock()

    monkeypatch.setattr(vp.subprocess, "run", fake_run)
    path = _pre(tmp_path)._extract_audio("v.mp4")
    assert path.endswith("audio.wav")
    assert captured["cmd"][0] == "ffmpeg"


def test_extract_audio_no_ffmpeg(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise FileNotFoundError()

    monkeypatch.setattr(vp.subprocess, "run", boom)
    with pytest.raises(PermanentError):
        _pre(tmp_path)._extract_audio("v.mp4")


def test_extract_audio_timeout(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1)

    monkeypatch.setattr(vp.subprocess, "run", boom)
    with pytest.raises(TransientError):
        _pre(tmp_path)._extract_audio("v.mp4")


def test_extract_audio_called_process_error(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise subprocess.CalledProcessError(returncode=1, cmd="ffmpeg", stderr="bad")

    monkeypatch.setattr(vp.subprocess, "run", boom)
    with pytest.raises(PermanentError):
        _pre(tmp_path)._extract_audio("v.mp4")


# ---- _download_video ----
def test_download_writes_chunks(tmp_path, monkeypatch):
    session = MagicMock()
    session.get.return_value = _FakeResp((b"abc", b"def"))
    monkeypatch.setattr(vp, "get_storage_session", lambda: session)

    path = _pre(tmp_path)._download_video()

    assert path.endswith("video.mp4")
    with open(path, "rb") as fh:
        assert fh.read() == b"abcdef"


def test_download_missing_extension_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(vp, "get_storage_session", lambda: MagicMock())
    with pytest.raises(PermanentError):
        _pre(tmp_path, video_path="novid")._download_video()


@pytest.mark.parametrize("code", [400, 401, 403, 404])
def test_download_client_errors_are_permanent(tmp_path, monkeypatch, code):
    session = MagicMock()
    session.get.return_value = _FakeResp(raise_exc=_http_error(code))
    monkeypatch.setattr(vp, "get_storage_session", lambda: session)
    with pytest.raises(PermanentError):
        _pre(tmp_path)._download_video()


@pytest.mark.parametrize("code", [408, 429, 500, 503])
def test_download_retryable_errors_are_transient(tmp_path, monkeypatch, code):
    session = MagicMock()
    session.get.return_value = _FakeResp(raise_exc=_http_error(code))
    monkeypatch.setattr(vp, "get_storage_session", lambda: session)
    with pytest.raises(TransientError):
        _pre(tmp_path)._download_video()


def test_download_timeout_is_transient(tmp_path, monkeypatch):
    session = MagicMock()
    session.get.side_effect = requests.Timeout()
    monkeypatch.setattr(vp, "get_storage_session", lambda: session)
    with pytest.raises(TransientError):
        _pre(tmp_path)._download_video()


def test_download_connection_error_is_transient(tmp_path, monkeypatch):
    session = MagicMock()
    session.get.side_effect = requests.ConnectionError()
    monkeypatch.setattr(vp, "get_storage_session", lambda: session)
    with pytest.raises(TransientError):
        _pre(tmp_path)._download_video()


# ---- _sample_frames ----
def test_sample_frames_delegates_to_frame_sampler(tmp_path, monkeypatch):
    meta = VideoMetadata(1.0, 30.0, 1920, 1080, 1)
    sampler = MagicMock()
    sampler.run.return_value = ["frame"]
    ctor = MagicMock(return_value=sampler)
    monkeypatch.setattr(vp, "FrameSampler", ctor)

    out = _pre(tmp_path)._sample_frames("v.mp4", meta)

    assert out == ["frame"]
    ctor.assert_called_once_with(
        "v.mp4",
        meta,
        str(tmp_path),
        product_imgs_folder_path="p",
        logo_imgs_folder_path="l",
    )


# ---- prepare (orchestration) ----
def test_prepare_builds_artifacts(tmp_path, monkeypatch):
    pre = _pre(tmp_path)
    meta = VideoMetadata(12.5, 30.0, 1920, 1080, 999)
    monkeypatch.setattr(pre, "_download_video", lambda: "v.mp4")
    monkeypatch.setattr(pre, "_probe_metadata", lambda p: meta)
    monkeypatch.setattr(pre, "_extract_audio", lambda p: "a.wav")
    monkeypatch.setattr(pre, "_sample_frames", lambda p, m: [])

    art = pre.prepare()

    assert art.job_id == "r1"
    assert art.storage_ref == "videos/dir/vid.mp4"
    assert art.video_path == "v.mp4"
    assert art.audio_path == "a.wav"
    assert art.frames == ()
    assert art.video_metadata is meta
    assert art.work_dir == str(tmp_path)
