"""Public-behavior tests for hosted Roboflow EasyOCR recognition."""

import pytest
import requests

pytestmark = pytest.mark.unit

from analyzer.frame_sampling.probes.ocr_candidates import (  # noqa: E402
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.hosted_ocr import (  # noqa: E402
    RoboflowEasyOcrAdapter,
    RoboflowEasyOcrWorkflowClient,
    build_roboflow_easyocr_adapter_from_env,
)
from analyzer.ocr_recognition import RawOcrReading  # noqa: E402
from app.errors import PermanentError, TransientError  # noqa: E402


class RecordedEasyOcrWorkflow:
    """Return one known hosted response without making a paid network call."""

    def infer(self, image_bytes: bytes) -> object:
        """Represent the public response from a pinned EasyOCR Workflow."""
        assert image_bytes == b"recorded-jpeg"
        return [
            {
                "text": "  SALE  ",
                "predictions": {
                    "image": {
                        "width": None,
                        "height": None,
                    },
                    "predictions": [
                        {
                            "x": 60.0,
                            "y": 20.0,
                            "width": 80.0,
                            "height": 20.0,
                            "confidence": 0.91,
                            "class": "  SALE  ",
                            "class_id": 0,
                        },
                        {
                            "x": 150.0,
                            "y": 50.0,
                            "width": 40.0,
                            "height": 20.0,
                            "class": "New\nLine",
                            "class_id": 0,
                        },
                    ],
                },
            }
        ]


def test_hosted_easyocr_normalizes_recorded_prediction(tmp_path) -> None:
    """One hosted prediction becomes compact source-aligned OCR evidence."""
    candidate_path = tmp_path / "candidate.jpg"
    candidate_path.write_bytes(b"recorded-jpeg")
    candidate = OcrCandidate(
        index=7,
        timestamp=1.75,
        model_input=None,
        path=str(candidate_path),
        source_dimensions=(400, 200),
        encoded_dimensions=(200, 100),
        scale=0.5,
        encoded_bytes=len(b"recorded-jpeg"),
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    readings = RoboflowEasyOcrAdapter(
        workflow=RecordedEasyOcrWorkflow(),
    ).recognize(candidate)

    assert readings == (
        RawOcrReading(
            source_frame_index=7,
            timestamp_s=1.75,
            text="  SALE  ",
            rectangle=(0.1, 0.1, 0.4, 0.2),
            confidence=0.91,
        ),
        RawOcrReading(
            source_frame_index=7,
            timestamp_s=1.75,
            text="New\nLine",
            rectangle=(0.65, 0.4, 0.2, 0.2),
            confidence=None,
        ),
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("x", float("inf")),
        ("confidence", float("nan")),
    ],
)
def test_hosted_easyocr_rejects_non_finite_prediction_numbers(
    tmp_path,
    field,
    value,
) -> None:
    """Non-finite provider numbers cannot enter normalized OCR evidence."""

    class NonFiniteWorkflow:
        """Return one prediction containing a non-finite numeric field."""

        def infer(self, image_bytes: bytes) -> object:
            prediction = {
                "x": 60.0,
                "y": 20.0,
                "width": 80.0,
                "height": 20.0,
                "confidence": 0.91,
                "class": "SALE",
            }
            prediction[field] = value
            return [
                {
                    "text": "SALE",
                    "predictions": {
                        "image": {"width": None, "height": None},
                        "predictions": [prediction],
                    },
                }
            ]

    candidate_path = tmp_path / "candidate.jpg"
    candidate_path.write_bytes(b"recorded-jpeg")
    candidate = OcrCandidate(
        index=7,
        timestamp=1.75,
        model_input=None,
        path=str(candidate_path),
        source_dimensions=(400, 200),
        encoded_dimensions=(200, 100),
        scale=0.5,
        encoded_bytes=len(b"recorded-jpeg"),
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    with pytest.raises(
        PermanentError,
        match="Roboflow EasyOCR returned an unsupported response",
    ):
        RoboflowEasyOcrAdapter(workflow=NonFiniteWorkflow()).recognize(candidate)


def test_hosted_easyocr_rejects_unsupported_response_without_payload_leak(
    tmp_path,
) -> None:
    """Malformed provider output becomes a compact permanent OCR failure."""

    class UnsupportedWorkflow:
        """Return an envelope outside the pinned single-image contract."""

        def infer(self, image_bytes: bytes) -> object:
            assert image_bytes == b"private-candidate-bytes"
            return {
                "unexpected": "private-provider-body",
            }

    candidate_path = tmp_path / "private-candidate.jpg"
    candidate_path.write_bytes(b"private-candidate-bytes")
    candidate = OcrCandidate(
        index=3,
        timestamp=0.75,
        model_input=None,
        path=str(candidate_path),
        source_dimensions=(200, 100),
        encoded_dimensions=(200, 100),
        scale=1.0,
        encoded_bytes=len(b"private-candidate-bytes"),
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    with pytest.raises(
        PermanentError,
        match="Roboflow EasyOCR returned an unsupported response",
    ) as error:
        RoboflowEasyOcrAdapter(
            workflow=UnsupportedWorkflow(),
        ).recognize(candidate)

    assert "private-provider-body" not in str(error.value)
    assert "private-candidate-bytes" not in str(error.value)
    assert error.value.__cause__ is None
    assert error.value.__context__ is None


def test_hosted_easyocr_timeout_is_a_safe_transient_failure() -> None:
    """A provider timeout remains retryable without exposing request data."""

    class TimeoutSession:
        """Record the public request contract before simulating a timeout."""

        def post(self, url, *, json, timeout):
            assert url == (
                "https://serverless.roboflow.com/infer/workflows/"
                "private-workspace/private-easyocr"
            )
            assert json == {
                "api_key": "private-api-key",
                "inputs": {
                    "image": {
                        "type": "base64",
                        "value": "cHJpdmF0ZS1pbWFnZS1ieXRlcw==",
                    }
                },
            }
            assert timeout == 12.5
            raise requests.Timeout("private-timeout-details")

    client = RoboflowEasyOcrWorkflowClient(
        api_key="private-api-key",
        workspace_id="private-workspace",
        workflow_id="private-easyocr",
        timeout_seconds=12.5,
        session=TimeoutSession(),
    )

    with pytest.raises(
        TransientError,
        match="Roboflow EasyOCR request timed out",
    ) as error:
        client.infer(b"private-image-bytes")

    assert "private-api-key" not in str(error.value)
    assert "private-image-bytes" not in str(error.value)
    assert "private-timeout-details" not in str(error.value)


@pytest.mark.parametrize(
    ("status_code", "error_type", "message"),
    [
        (429, TransientError, "Roboflow EasyOCR is temporarily unavailable"),
        (503, TransientError, "Roboflow EasyOCR is temporarily unavailable"),
        (400, PermanentError, "Roboflow EasyOCR rejected the request"),
        (401, PermanentError, "Roboflow EasyOCR rejected the request"),
    ],
)
def test_hosted_easyocr_classifies_http_failures_without_response_leaks(
    status_code,
    error_type,
    message,
) -> None:
    """Retry only throttling and server failures from the hosted boundary."""

    class RecordedResponse:
        """Represent a provider failure whose body must never be surfaced."""

        def __init__(self, recorded_status_code: int) -> None:
            self.status_code = recorded_status_code

        def json(self) -> object:
            return {"detail": "private-provider-response"}

    class RecordedSession:
        """Return one recorded failure without making a network call."""

        def post(self, url, *, json, timeout):
            return RecordedResponse(status_code)

    client = RoboflowEasyOcrWorkflowClient(
        api_key="private-api-key",
        workspace_id="private-workspace",
        workflow_id="private-easyocr",
        timeout_seconds=12.5,
        session=RecordedSession(),
    )

    with pytest.raises(error_type, match=message) as error:
        client.infer(b"private-image-bytes")

    assert "private-provider-response" not in str(error.value)
    assert "private-api-key" not in str(error.value)
    assert "private-image-bytes" not in str(error.value)


def test_hosted_easyocr_rejects_undecodable_success_response_safely() -> None:
    """Invalid JSON from a successful request is a permanent provider mismatch."""

    class UndecodableResponse:
        """Represent a nominal success with an unsupported response body."""

        status_code = 200

        def json(self) -> object:
            raise ValueError("private-undecodable-response")

    class RecordedSession:
        """Return the invalid recorded response without a network call."""

        def post(self, url, *, json, timeout):
            return UndecodableResponse()

    client = RoboflowEasyOcrWorkflowClient(
        api_key="private-api-key",
        workspace_id="private-workspace",
        workflow_id="private-easyocr",
        timeout_seconds=12.5,
        session=RecordedSession(),
    )

    with pytest.raises(
        PermanentError,
        match="Roboflow EasyOCR returned an unsupported response",
    ) as error:
        client.infer(b"private-image-bytes")

    assert "private-undecodable-response" not in str(error.value)
    assert "private-api-key" not in str(error.value)
    assert "private-image-bytes" not in str(error.value)


def test_hosted_easyocr_unwraps_only_workflow_outputs() -> None:
    """The HTTP boundary discards hosted response metadata immediately."""

    class RecordedResponse:
        """Return the envelope observed from the live hosted endpoint."""

        status_code = 200

        def json(self) -> object:
            return {
                "outputs": [
                    {
                        "text": "SALE",
                        "predictions": [],
                    }
                ],
                "profiler_trace": ["private-provider-profile"],
            }

    class RecordedSession:
        """Return one successful recorded response without a network call."""

        def post(self, url, *, json, timeout):
            return RecordedResponse()

    client = RoboflowEasyOcrWorkflowClient(
        api_key="private-api-key",
        workspace_id="private-workspace",
        workflow_id="private-easyocr",
        timeout_seconds=12.5,
        session=RecordedSession(),
    )

    assert client.infer(b"private-image-bytes") == [
        {
            "text": "SALE",
            "predictions": [],
        }
    ]


_ROBOFLOW_OCR_ENV_KEYS = (
    "ROBOFLOW_API_KEY",
    "ROBOFLOW_WORKSPACE_ID",
    "ROBOFLOW_OCR_WORKFLOW_ID",
    "ROBOFLOW_OCR_TIMEOUT_SECONDS",
)


def test_hosted_easyocr_environment_factory_is_disabled_by_default(
    monkeypatch,
) -> None:
    """An unconfigured worker must not silently enable paid OCR inference."""
    for key in _ROBOFLOW_OCR_ENV_KEYS:
        # Clear ambient developer configuration so this remains deterministic.
        monkeypatch.delenv(key, raising=False)

    assert build_roboflow_easyocr_adapter_from_env() is None


def test_hosted_easyocr_environment_factory_treats_blank_placeholders_as_disabled(
    monkeypatch,
) -> None:
    """An example env file with blank OCR values must not enable paid OCR."""
    for key in _ROBOFLOW_OCR_ENV_KEYS:
        monkeypatch.setenv(key, "")

    assert build_roboflow_easyocr_adapter_from_env() is None


def test_hosted_easyocr_environment_factory_builds_complete_adapter(
    monkeypatch,
) -> None:
    """A complete OCR-local environment enables the replaceable adapter."""
    monkeypatch.setenv("ROBOFLOW_API_KEY", "private-api-key")
    monkeypatch.setenv("ROBOFLOW_WORKSPACE_ID", "private-workspace")
    monkeypatch.setenv("ROBOFLOW_OCR_WORKFLOW_ID", "private-easyocr")
    monkeypatch.setenv("ROBOFLOW_OCR_TIMEOUT_SECONDS", "12.5")

    adapter = build_roboflow_easyocr_adapter_from_env()

    assert isinstance(adapter, RoboflowEasyOcrAdapter)


@pytest.mark.parametrize(
    ("configured_values", "message"),
    [
        (
            {"ROBOFLOW_API_KEY": "private-api-key"},
            "Roboflow EasyOCR configuration is incomplete",
        ),
        (
            {
                "ROBOFLOW_API_KEY": "private-api-key",
                "ROBOFLOW_WORKSPACE_ID": "private-workspace",
                "ROBOFLOW_OCR_WORKFLOW_ID": "private-easyocr",
                "ROBOFLOW_OCR_TIMEOUT_SECONDS": "not-private-numeric-timeout",
            },
            "Roboflow EasyOCR timeout is invalid",
        ),
    ],
)
def test_hosted_easyocr_environment_factory_rejects_invalid_configuration_safely(
    monkeypatch,
    configured_values,
    message,
) -> None:
    """Partial or invalid OCR configuration fails without exposing values."""
    for key in _ROBOFLOW_OCR_ENV_KEYS:
        # Each parameterized case begins from a fully unconfigured environment.
        monkeypatch.delenv(key, raising=False)
    for key, value in configured_values.items():
        monkeypatch.setenv(key, value)

    with pytest.raises(PermanentError, match=message) as error:
        build_roboflow_easyocr_adapter_from_env()

    for value in configured_values.values():
        assert value not in str(error.value)
