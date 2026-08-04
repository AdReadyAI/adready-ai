"""Hosted Roboflow EasyOCR adapter behind the provider-neutral OCR seam."""

import base64
import math
from numbers import Real
import os
from typing import Protocol

import requests

from analyzer.ocr.candidates import OcrCandidate
from analyzer.ocr.recognition import RawOcrReading
from app.errors import PermanentError, TransientError


_UNSUPPORTED_RESPONSE_MESSAGE = "Roboflow EasyOCR returned an unsupported response"


def _required_number(prediction: dict[str, object], field: str) -> float:
    """Read one finite-compatible numeric prediction field without coercion."""
    value = prediction[field]
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(field)
    normalized = float(value)
    if not math.isfinite(normalized):
        raise ValueError(field)
    return normalized


def _optional_confidence(prediction: dict[str, object]) -> float | None:
    """Normalize omitted confidence to ``None`` and reject categorical values."""
    value = prediction.get("confidence")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError("confidence")
    normalized = float(value)
    if not math.isfinite(normalized):
        raise ValueError("confidence")
    return normalized


def _normalize_workflow_response(
    response: object,
    candidate: OcrCandidate,
) -> tuple[RawOcrReading, ...]:
    """Discard provider structure while constructing compact OCR evidence."""
    if not isinstance(response, list) or len(response) != 1:
        raise TypeError("workflow result batch")
    workflow_output = response[0]
    if not isinstance(workflow_output, dict):
        raise TypeError("workflow output")
    prediction_output = workflow_output["predictions"]
    if not isinstance(prediction_output, dict):
        raise TypeError("prediction output")
    predictions = prediction_output["predictions"]
    if not isinstance(predictions, list):
        raise TypeError("predictions")

    encoded_width, encoded_height = candidate.encoded_dimensions
    readings = []
    for prediction in predictions:
        # Roboflow serializes boxes by pixel-space center. OCR consolidation
        # consumes normalized top-left rectangles instead.
        if not isinstance(prediction, dict):
            raise TypeError("prediction")
        text = prediction["class"]
        if not isinstance(text, str):
            raise TypeError("class")
        x = _required_number(prediction, "x")
        y = _required_number(prediction, "y")
        width = _required_number(prediction, "width")
        height = _required_number(prediction, "height")
        left = x - width / 2
        top = y - height / 2
        readings.append(
            RawOcrReading(
                source_frame_index=candidate.index,
                timestamp_s=candidate.timestamp,
                text=text,
                rectangle=(
                    left / encoded_width,
                    top / encoded_height,
                    width / encoded_width,
                    height / encoded_height,
                ),
                confidence=_optional_confidence(prediction),
            )
        )
    return tuple(readings)


def _unwrap_workflow_outputs(payload: object) -> list[object]:
    """Retain only Workflow outputs from the hosted response envelope."""
    if not isinstance(payload, dict):
        raise TypeError("hosted response")
    outputs = payload["outputs"]
    if not isinstance(outputs, list):
        raise TypeError("outputs")
    return outputs


class RoboflowEasyOcrWorkflow(Protocol):
    """Boundary for one pinned hosted EasyOCR Workflow."""

    def infer(self, image_bytes: bytes) -> object:
        """Run EasyOCR for one encoded source candidate."""
        ...


class RoboflowHttpResponse(Protocol):
    """Small response surface needed by the hosted Workflow client."""

    status_code: int

    def json(self) -> object:
        """Decode the provider response body."""
        ...


class RoboflowHttpSession(Protocol):
    """Injectable HTTP boundary used by recorded unit tests."""

    def post(
        self,
        url: str,
        *,
        json: dict[str, object],
        timeout: float,
    ) -> RoboflowHttpResponse:
        """Submit one Workflow inference request."""
        ...


class RoboflowEasyOcrWorkflowClient:
    """Call one pinned hosted EasyOCR Workflow without retaining image data."""

    def __init__(
        self,
        *,
        api_key: str,
        workspace_id: str,
        workflow_id: str,
        timeout_seconds: float,
        session: RoboflowHttpSession | None = None,
    ) -> None:
        self._api_key = api_key
        self._url = (
            "https://serverless.roboflow.com/infer/workflows/"
            f"{workspace_id}/{workflow_id}"
        )
        self._timeout_seconds = timeout_seconds
        self._session = session or requests.Session()

    def infer(self, image_bytes: bytes) -> object:
        """Submit one image and return its decoded Workflow response."""
        encoded_image = base64.b64encode(image_bytes).decode("ascii")
        try:
            response = self._session.post(
                self._url,
                json={
                    "api_key": self._api_key,
                    "inputs": {
                        "image": {
                            "type": "base64",
                            "value": encoded_image,
                        }
                    },
                },
                timeout=self._timeout_seconds,
            )
        except requests.Timeout:
            # The original exception may include request internals, so suppress
            # its chained representation at the worker boundary.
            raise TransientError("Roboflow EasyOCR request timed out") from None

        # Classify failures before decoding their bodies. Provider error bodies
        # may contain request details and are not needed by downstream OCR.
        if response.status_code == 429 or 500 <= response.status_code <= 599:
            raise TransientError("Roboflow EasyOCR is temporarily unavailable")
        if 400 <= response.status_code <= 499:
            raise PermanentError("Roboflow EasyOCR rejected the request")
        try:
            payload = response.json()
        except ValueError:
            # JSON decoder errors can embed fragments of the provider body.
            raise PermanentError(_UNSUPPORTED_RESPONSE_MESSAGE) from None
        try:
            return _unwrap_workflow_outputs(payload)
        except (KeyError, TypeError):
            # Drop the decoded envelope so provider metadata is not retained by
            # the safe error raised after this exception handler exits.
            payload = None
        raise PermanentError(_UNSUPPORTED_RESPONSE_MESSAGE)


class RoboflowEasyOcrAdapter:
    """Normalize hosted EasyOCR output into compact Raw OCR Readings."""

    def __init__(self, *, workflow: RoboflowEasyOcrWorkflow) -> None:
        self._workflow = workflow

    def recognize(
        self,
        candidate: OcrCandidate,
    ) -> tuple[RawOcrReading, ...]:
        """Recognize one candidate while retaining only normalized evidence."""
        with open(candidate.path, "rb") as candidate_file:
            response = self._workflow.infer(candidate_file.read())

        try:
            return _normalize_workflow_response(response, candidate)
        except (IndexError, KeyError, TypeError, ValueError, ZeroDivisionError):
            # Drop the caller's final reference before leaving the exception
            # handler; the helper traceback and provider payload then expire.
            response = None

        # Raise outside the handler so no provider exception or traceback is
        # retained as context on the worker-safe permanent failure.
        raise PermanentError(_UNSUPPORTED_RESPONSE_MESSAGE)


def build_roboflow_easyocr_adapter_from_env() -> RoboflowEasyOcrAdapter | None:
    """Build hosted OCR only from a complete OCR-local environment."""
    keys = (
        "ROBOFLOW_API_KEY",
        "ROBOFLOW_WORKSPACE_ID",
        "ROBOFLOW_OCR_WORKFLOW_ID",
        "ROBOFLOW_OCR_TIMEOUT_SECONDS",
    )
    values = {key: os.environ.get(key) for key in keys}
    if all(value is None or not value.strip() for value in values.values()):
        return None
    if any(value is None or not value.strip() for value in values.values()):
        raise PermanentError("Roboflow EasyOCR configuration is incomplete")

    try:
        timeout_seconds = float(values["ROBOFLOW_OCR_TIMEOUT_SECONDS"])
    except ValueError:
        raise PermanentError("Roboflow EasyOCR timeout is invalid") from None
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise PermanentError("Roboflow EasyOCR timeout is invalid")

    workflow = RoboflowEasyOcrWorkflowClient(
        api_key=values["ROBOFLOW_API_KEY"],
        workspace_id=values["ROBOFLOW_WORKSPACE_ID"],
        workflow_id=values["ROBOFLOW_OCR_WORKFLOW_ID"],
        timeout_seconds=timeout_seconds,
    )
    return RoboflowEasyOcrAdapter(workflow=workflow)
