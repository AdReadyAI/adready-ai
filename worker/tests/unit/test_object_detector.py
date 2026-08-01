"""Unit tests for the Roboflow OWLv2 client (analyzer/object_detector.py)."""

from unittest.mock import MagicMock

import numpy as np
import cv2
import pytest
import requests

pytestmark = pytest.mark.unit

import analyzer.object_detector as od
from app.errors import PermanentError, TransientError


def _write_image(path, size=(20, 10)):
    width, height = size
    cv2.imwrite(str(path), np.zeros((height, width, 3), dtype=np.uint8))
    return str(path)


class _FakeResponse:
    def __init__(self, json_data, raise_exc=None):
        self._json = json_data
        self._raise = raise_exc

    def raise_for_status(self):
        if self._raise:
            raise self._raise

    def json(self):
        return self._json


def _http_error(code):
    resp = MagicMock()
    resp.status_code = code
    return requests.HTTPError(response=resp)


# ---- construction ----
def test_reference_detector_builds_training_data_from_full_image_box(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg", size=(40, 20))

    detector = od.ReferenceDetector([ref_path], label="product")

    assert len(detector._training_data) == 1
    boxes = detector._training_data[0]["boxes"]
    assert boxes == [{"x": 0, "y": 0, "w": 40, "h": 20, "cls": "product"}]


def test_reference_detector_no_references_never_calls_network(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    detector = od.ReferenceDetector([], label="product")

    target = _write_image(tmp_path / "t.jpg")
    assert detector.detect(target, confidence=0.5) is None


# ---- detect() ----
def test_detect_missing_api_key_raises_permanent(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", None)
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")

    with pytest.raises(PermanentError):
        detector.detect(_write_image(tmp_path / "t.jpg"), confidence=0.5)


def test_detect_returns_best_prediction_normalized(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg", size=(20, 10))

    predictions = {
        "predictions": [
            {"confidence": 0.5, "x": 5, "y": 5, "width": 4, "height": 2},
            {"confidence": 0.9, "x": 10, "y": 5, "width": 8, "height": 4},
        ]
    }
    monkeypatch.setattr(
        od.requests, "post", lambda *a, **k: _FakeResponse(predictions)
    )

    detection = detector.detect(target, confidence=0.1)

    assert detection is not None
    assert detection.confidence == 0.9
    assert detection.x == pytest.approx(0.5)
    assert detection.y == pytest.approx(0.5)
    assert detection.w == pytest.approx(0.4)
    assert detection.h == pytest.approx(0.4)


def test_detect_no_predictions_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg")

    monkeypatch.setattr(
        od.requests, "post", lambda *a, **k: _FakeResponse({"predictions": []})
    )

    assert detector.detect(target, confidence=0.1) is None


def test_detect_malformed_prediction_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg")

    monkeypatch.setattr(
        od.requests,
        "post",
        lambda *a, **k: _FakeResponse({"predictions": [{"confidence": 0.9}]}),
    )

    assert detector.detect(target, confidence=0.1) is None


@pytest.mark.parametrize("code", [400, 401, 403, 404])
def test_detect_client_errors_are_permanent(tmp_path, monkeypatch, code):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg")

    monkeypatch.setattr(
        od.requests,
        "post",
        lambda *a, **k: _FakeResponse(None, raise_exc=_http_error(code)),
    )

    with pytest.raises(PermanentError):
        detector.detect(target, confidence=0.1)


@pytest.mark.parametrize("code", [408, 429, 500, 503])
def test_detect_retryable_errors_are_transient(tmp_path, monkeypatch, code):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg")

    monkeypatch.setattr(
        od.requests,
        "post",
        lambda *a, **k: _FakeResponse(None, raise_exc=_http_error(code)),
    )

    with pytest.raises(TransientError):
        detector.detect(target, confidence=0.1)


def test_detect_timeout_is_transient(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg")

    def boom(*a, **k):
        raise requests.Timeout()

    monkeypatch.setattr(od.requests, "post", boom)

    with pytest.raises(TransientError):
        detector.detect(target, confidence=0.1)


def test_detect_connection_error_is_transient(tmp_path, monkeypatch):
    monkeypatch.setattr(od, "ROBOFLOW_API_KEY", "key")
    ref_path = _write_image(tmp_path / "ref.jpg")
    detector = od.ReferenceDetector([ref_path], label="product")
    target = _write_image(tmp_path / "t.jpg")

    def boom(*a, **k):
        raise requests.ConnectionError()

    monkeypatch.setattr(od.requests, "post", boom)

    with pytest.raises(TransientError):
        detector.detect(target, confidence=0.1)
