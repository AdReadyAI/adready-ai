"""Public-behavior tests for OCR-local runtime configuration."""

import pytest

from analyzer.ocr.configuration import OcrRuntimeConfig
from analyzer.ocr.routing import OcrCandidateMode
from app.errors import PermanentError


pytestmark = pytest.mark.unit


_OCR_RUNTIME_KEYS = (
    "OCR_CANDIDATE_MODE",
    "OCR_EVIDENCE_BUCKET",
    "OCR_EVIDENCE_STORAGE_TIMEOUT_SECONDS",
)


def test_runtime_configuration_has_safe_fixed_rate_defaults(monkeypatch):
    """Unspecified activation remains fixed-rate with private evidence."""
    for key in _OCR_RUNTIME_KEYS:
        monkeypatch.delenv(key, raising=False)

    configuration = OcrRuntimeConfig.from_env()

    assert configuration.candidate_mode is OcrCandidateMode.FIXED_4FPS
    assert configuration.evidence_bucket == "ocr-evidence"
    assert configuration.evidence_storage_timeout_seconds == 30


def test_runtime_configuration_accepts_explicit_shadow_profile(monkeypatch):
    """Deployment can request shadow behavior without changing code defaults."""
    monkeypatch.setenv("OCR_CANDIDATE_MODE", "cascade_shadow")
    monkeypatch.setenv("OCR_EVIDENCE_BUCKET", "private-ocr-evidence")
    monkeypatch.setenv("OCR_EVIDENCE_STORAGE_TIMEOUT_SECONDS", "12.5")

    configuration = OcrRuntimeConfig.from_env()

    assert configuration.candidate_mode is OcrCandidateMode.CASCADE_SHADOW
    assert configuration.evidence_bucket == "private-ocr-evidence"
    assert configuration.evidence_storage_timeout_seconds == 12.5


@pytest.mark.parametrize(
    ("key", "value"),
    [
        pytest.param("OCR_CANDIDATE_MODE", "automatic", id="mode"),
        pytest.param("OCR_EVIDENCE_BUCKET", "../private", id="bucket"),
        pytest.param(
            "OCR_EVIDENCE_STORAGE_TIMEOUT_SECONDS",
            "nan",
            id="timeout",
        ),
    ],
)
def test_runtime_configuration_rejects_invalid_values(
    monkeypatch,
    key,
    value,
):
    """Invalid activation fails before media decoding or hosted OCR."""
    for environment_key in _OCR_RUNTIME_KEYS:
        monkeypatch.delenv(environment_key, raising=False)
    monkeypatch.setenv(key, value)

    with pytest.raises(PermanentError, match="OCR runtime configuration"):
        OcrRuntimeConfig.from_env()
