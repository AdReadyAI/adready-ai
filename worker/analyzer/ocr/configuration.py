"""Validate OCR-local production activation from environment configuration."""

from dataclasses import dataclass
import math
import os
import re

from analyzer.ocr.routing import OcrCandidateMode
from app.errors import PermanentError


_SAFE_BUCKET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_CONFIGURATION_ERROR = "OCR runtime configuration is invalid"


@dataclass(frozen=True)
class OcrRuntimeConfig:
    """One validated production configuration for an OCR Run."""

    candidate_mode: OcrCandidateMode
    evidence_bucket: str
    evidence_storage_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "OcrRuntimeConfig":
        """Load safe defaults and reject invalid activation before decoding."""
        try:
            candidate_mode = OcrCandidateMode(
                os.environ.get(
                    "OCR_CANDIDATE_MODE",
                    OcrCandidateMode.FIXED_4FPS.value,
                ).strip()
            )
            evidence_bucket = os.environ.get(
                "OCR_EVIDENCE_BUCKET",
                "ocr-evidence",
            ).strip()
            timeout_seconds = float(
                os.environ.get(
                    "OCR_EVIDENCE_STORAGE_TIMEOUT_SECONDS",
                    "30",
                ).strip()
            )
        except (AttributeError, TypeError, ValueError):
            raise PermanentError(_CONFIGURATION_ERROR) from None

        if (
            not _SAFE_BUCKET.fullmatch(evidence_bucket)
            or not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
        ):
            raise PermanentError(_CONFIGURATION_ERROR)

        return cls(
            candidate_mode=candidate_mode,
            evidence_bucket=evidence_bucket,
            evidence_storage_timeout_seconds=timeout_seconds,
        )
