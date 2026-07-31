"""Explicit live smoke test for the hosted Roboflow EasyOCR adapter."""

import os

import cv2
import numpy as np
import pytest

from analyzer.frame_sampling.probes.ocr_candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.hosted_ocr import build_roboflow_easyocr_adapter_from_env


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_ROBOFLOW_OCR_SMOKE") != "1",
        reason="set RUN_ROBOFLOW_OCR_SMOKE=1 to invoke hosted EasyOCR",
    ),
]

_REQUIRED_ENV_KEYS = (
    "ROBOFLOW_API_KEY",
    "ROBOFLOW_WORKSPACE_ID",
    "ROBOFLOW_OCR_WORKFLOW_ID",
    "ROBOFLOW_OCR_TIMEOUT_SECONDS",
)


def test_hosted_easyocr_recognizes_generated_text(tmp_path) -> None:
    """Send one generated image through the real hosted OCR Workflow."""
    missing_keys = [
        key
        for key in _REQUIRED_ENV_KEYS
        if not os.environ.get(key, "").strip()
    ]
    if missing_keys:
        # Report only variable names; credential values must never enter test
        # output, even when the opt-in flag was set accidentally.
        pytest.skip(f"missing hosted OCR configuration: {', '.join(missing_keys)}")

    image = np.full((240, 720, 3), 255, dtype=np.uint8)
    cv2.putText(
        image,
        "LIMITED OFFER",
        (35, 145),
        cv2.FONT_HERSHEY_SIMPLEX,
        2.0,
        (0, 0, 0),
        5,
        cv2.LINE_AA,
    )
    candidate_path = tmp_path / "roboflow-ocr-smoke.jpg"
    if not cv2.imwrite(str(candidate_path), image):
        pytest.fail("OpenCV could not encode the hosted OCR smoke image")

    adapter = build_roboflow_easyocr_adapter_from_env()
    assert adapter is not None
    readings = adapter.recognize(
        OcrCandidate(
            index=0,
            timestamp=0.0,
            model_input=None,
            path=str(candidate_path),
            source_dimensions=(720, 240),
            encoded_dimensions=(720, 240),
            scale=1.0,
            encoded_bytes=candidate_path.stat().st_size,
            provenance=(OcrCandidateProvenance.PERIODIC,),
        )
    )

    assert readings
    assert any(reading.text.strip() for reading in readings)
    assert all(
        width > 0 and height > 0
        for reading in readings
        for _, _, width, height in (reading.rectangle,)
    )
