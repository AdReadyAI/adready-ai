"""Unit tests for the OpenRouter vision captioner (analyzer/visual_captioner.py)."""

import base64
import io
from unittest.mock import MagicMock

import httpx
import openai
import pytest
from PIL import Image

pytestmark = pytest.mark.unit

import analyzer.visual_captioner as vc
from app.errors import PermanentError, TransientError


def _write_image(path, size=(20, 10)):
    Image.new("RGB", size, color=(120, 60, 200)).save(path, format="JPEG")
    return str(path)


def _completion_with_parsed(parsed):
    completion = MagicMock()
    completion.choices = [MagicMock(message=MagicMock(parsed=parsed))]
    return completion


def _sample_output():
    return vc.VisualCaptionOutput(action="A hand opens a jar.")


def _request():
    return httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")


def _status_error(cls, code, message="error"):
    resp = httpx.Response(code, request=_request())
    return cls(message, response=resp, body=None)


def _make_captioner(monkeypatch, mock_client=None):
    client = mock_client or MagicMock()
    monkeypatch.setattr(vc, "get_openrouter_client", lambda: client)
    return vc.VisualCaptioner(), client


# ---- successful call ----
def test_caption_success_returns_parsed_output(tmp_path, monkeypatch):
    expected = _sample_output()
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.return_value = _completion_with_parsed(expected)

    frame = _write_image(tmp_path / "frame.jpg", size=(800, 400))
    result = captioner.caption(frame, is_shot_start=False)

    assert result is expected
    call_kwargs = client.chat.completions.parse.call_args.kwargs
    assert call_kwargs["response_format"] is vc.VisualCaptionOutput
    user_content = call_kwargs["messages"][1]["content"]
    image_url = user_content[1]["image_url"]["url"]
    assert image_url.startswith("data:image/jpeg;base64,")


def test_caption_downscales_large_image(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.return_value = _completion_with_parsed(_sample_output())

    frame = _write_image(tmp_path / "frame.jpg", size=(800, 400))
    captioner.caption(frame, is_shot_start=False)

    call_kwargs = client.chat.completions.parse.call_args.kwargs
    image_url = call_kwargs["messages"][1]["content"][1]["image_url"]["url"]
    encoded = image_url.split(",", 1)[1]
    decoded = Image.open(io.BytesIO(base64.b64decode(encoded)))
    assert max(decoded.size) == 384
    assert decoded.size == (384, 192)


def test_caption_does_not_upscale_small_image(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.return_value = _completion_with_parsed(_sample_output())

    frame = _write_image(tmp_path / "frame.jpg", size=(100, 50))
    captioner.caption(frame, is_shot_start=False)

    call_kwargs = client.chat.completions.parse.call_args.kwargs
    image_url = call_kwargs["messages"][1]["content"][1]["image_url"]["url"]
    encoded = image_url.split(",", 1)[1]
    decoded = Image.open(io.BytesIO(base64.b64decode(encoded)))
    assert decoded.size == (100, 50)


@pytest.mark.parametrize(
    "is_shot_start,expected_line",
    [
        (True, "This frame is the first frame immediately after a cut."),
        (False, "This frame is a continuation within an existing shot."),
    ],
)
def test_caption_user_message_line_depends_on_shot_start(
    tmp_path, monkeypatch, is_shot_start, expected_line
):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.return_value = _completion_with_parsed(_sample_output())

    frame = _write_image(tmp_path / "frame.jpg")
    captioner.caption(frame, is_shot_start=is_shot_start)

    call_kwargs = client.chat.completions.parse.call_args.kwargs
    text_part = call_kwargs["messages"][1]["content"][0]
    assert text_part == {"type": "text", "text": expected_line}


# ---- refusal ----
def test_caption_refusal_raises_permanent(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.return_value = _completion_with_parsed(None)

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(PermanentError):
        captioner.caption(frame, is_shot_start=False)


# ---- transient errors ----
def test_caption_rate_limit_is_transient(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.side_effect = _status_error(openai.RateLimitError, 429)

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(TransientError):
        captioner.caption(frame, is_shot_start=False)


def test_caption_timeout_is_transient(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.side_effect = openai.APITimeoutError(request=_request())

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(TransientError):
        captioner.caption(frame, is_shot_start=False)


def test_caption_connection_error_is_transient(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.side_effect = openai.APIConnectionError(request=_request())

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(TransientError):
        captioner.caption(frame, is_shot_start=False)


def test_caption_server_error_is_transient(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.side_effect = _status_error(openai.InternalServerError, 500)

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(TransientError):
        captioner.caption(frame, is_shot_start=False)


# ---- permanent errors ----
def test_caption_bad_request_is_permanent(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.side_effect = _status_error(openai.BadRequestError, 400)

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(PermanentError):
        captioner.caption(frame, is_shot_start=False)


def test_caption_authentication_error_is_permanent(tmp_path, monkeypatch):
    captioner, client = _make_captioner(monkeypatch)
    client.chat.completions.parse.side_effect = _status_error(openai.AuthenticationError, 401)

    frame = _write_image(tmp_path / "frame.jpg")
    with pytest.raises(PermanentError):
        captioner.caption(frame, is_shot_start=False)
