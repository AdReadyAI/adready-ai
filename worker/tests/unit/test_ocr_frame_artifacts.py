"""Public-behavior tests for deterministic OCR frame artifact storage."""

import os

import cv2
import numpy as np
import pytest
import requests

from analyzer.ocr.candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.ocr.frame_artifacts import (
    LocalOcrFrameArtifactStore,
    SupabaseOcrFrameArtifactStore,
)
from app.errors import PermanentError, TransientError


pytestmark = pytest.mark.unit


def _candidate(tmp_path, index: int) -> OcrCandidate:
    """Create one source candidate file at the artifact storage seam."""
    candidate_path = tmp_path / f"candidate-{index:06d}.jpg"
    cv2.imwrite(
        str(candidate_path),
        np.full((20, 40, 3), index, dtype=np.uint8),
    )
    return OcrCandidate(
        index=index,
        timestamp=index / 20,
        model_input=None,
        path=str(candidate_path),
        source_dimensions=(40, 20),
        encoded_dimensions=(40, 20),
        scale=1.0,
        encoded_bytes=os.path.getsize(candidate_path),
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )


def test_local_artifacts_are_run_scoped_deduplicated_and_idempotent(
    tmp_path,
):
    """Repeated storage reuses one immutable artifact per supporting frame."""
    candidates = tuple(
        _candidate(tmp_path, index)
        for index in (0, 5, 10)
    )
    store = LocalOcrFrameArtifactStore(work_dir=str(tmp_path))

    first = store.store(
        ocr_run_id="ocr-run-123",
        candidates=(candidates[0], candidates[1], candidates[1], candidates[2]),
    )
    second = store.store(
        ocr_run_id="ocr-run-123",
        candidates=candidates,
    )

    assert [
        (artifact.source_frame_index, artifact.frame_id)
        for artifact in first
    ] == [
        (0, "ocr-run-123-frame-000000"),
        (5, "ocr-run-123-frame-000005"),
        (10, "ocr-run-123-frame-000010"),
    ]
    assert second == first
    assert all(os.path.isfile(artifact.path) for artifact in first)
    assert len(list((tmp_path / "ocr-artifacts" / "ocr-run-123").iterdir())) == 3


def test_supabase_artifacts_upload_once_and_reuse_identical_objects(tmp_path):
    """Durable redelivery reuses immutable private frame evidence."""

    class Response:
        """Expose only the storage response behavior used by the adapter."""

        def __init__(self, status_code, content=b""):
            self.status_code = status_code
            self.content = content

    class StorageSession:
        """Model private object creation and retrieval without network I/O."""

        def __init__(self):
            self.objects = {}

        def post(self, url, *, data, headers, timeout):
            """Create one immutable object or report its existing identity."""
            if url in self.objects:
                return Response(409)
            self.objects[url] = data
            return Response(200)

        def get(self, url, *, timeout):
            """Return existing bytes only for redelivery verification."""
            return Response(200, self.objects[url])

    session = StorageSession()
    candidate = _candidate(tmp_path, 5)
    store = SupabaseOcrFrameArtifactStore(
        supabase_url="https://supabase.example",
        bucket="ocr-evidence",
        session=session,
        timeout_seconds=10,
    )

    first = store.store(
        ocr_run_id="ocr-run-123",
        candidates=(candidate, candidate),
    )
    second = store.store(
        ocr_run_id="ocr-run-123",
        candidates=(candidate,),
    )

    assert second == first
    assert first[0].frame_id == "ocr-run-123-frame-000005"
    assert first[0].path == (
        "ocr-evidence/ocr-runs/ocr-run-123/frames/"
        "ocr-run-123-frame-000005.jpg"
    )
    assert len(session.objects) == 1


@pytest.mark.parametrize(
    ("failure", "expected_error"),
    [
        pytest.param("timeout", TransientError, id="timeout"),
        pytest.param(408, TransientError, id="request-timeout"),
        pytest.param(429, TransientError, id="rate-limit"),
        pytest.param(503, TransientError, id="server-error"),
        pytest.param(401, PermanentError, id="authentication"),
        pytest.param(403, PermanentError, id="authorization"),
        pytest.param(404, PermanentError, id="missing-bucket"),
    ],
)
def test_supabase_artifact_failures_are_sanitized_and_classified(
    tmp_path,
    failure,
    expected_error,
):
    """Storage failures retain retry meaning without leaking provider data."""

    class Response:
        """Expose a status while retaining a body that must stay private."""

        status_code = failure
        content = b"private provider response body"

    class FailingSession:
        """Return or raise one configured external storage failure."""

        def post(self, url, *, data, headers, timeout):
            if failure == "timeout":
                raise requests.Timeout("private signed request details")
            return Response()

    store = SupabaseOcrFrameArtifactStore(
        supabase_url="https://private-project.supabase.co",
        bucket="ocr-evidence",
        session=FailingSession(),
        timeout_seconds=10,
    )

    with pytest.raises(expected_error) as raised:
        store.store(
            ocr_run_id="ocr-run-123",
            candidates=(_candidate(tmp_path, 5),),
        )

    message = str(raised.value)
    assert "private" not in message
    assert "supabase.co" not in message
