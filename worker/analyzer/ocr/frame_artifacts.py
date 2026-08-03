"""OCR-owned frame artifact seam and deterministic local adapter."""

from dataclasses import dataclass
import hashlib
import os
import re
import requests
import shutil
from typing import Protocol
from urllib.parse import quote

from analyzer.ocr.candidates import OcrCandidate
from app.errors import PermanentError, TransientError


@dataclass(frozen=True)
class OcrFrameArtifact:
    """One stable frame reference stored separately from OCR Result rows."""

    frame_id: str
    source_frame_index: int
    timestamp_s: float
    path: str


class OcrFrameArtifactStore(Protocol):
    """Replaceable storage seam for local and later private hosted adapters."""

    def store(
        self,
        *,
        ocr_run_id: str,
        candidates: tuple[OcrCandidate, ...],
    ) -> tuple[OcrFrameArtifact, ...]:
        """Store each source frame once and return stable artifact references."""
        ...


class LocalOcrFrameArtifactStore:
    """Store immutable OCR frame artifacts within a deterministic local tree."""

    _SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9_-]+$")

    def __init__(self, *, work_dir: str) -> None:
        self._root = os.path.join(work_dir, "ocr-artifacts")

    def store(
        self,
        *,
        ocr_run_id: str,
        candidates: tuple[OcrCandidate, ...],
    ) -> tuple[OcrFrameArtifact, ...]:
        """Copy unique candidates without overwriting conflicting artifacts."""
        if not self._SAFE_RUN_ID.fullmatch(ocr_run_id):
            raise ValueError("OCR Run ID is unsafe for artifact storage")

        run_directory = os.path.join(self._root, ocr_run_id)
        os.makedirs(run_directory, exist_ok=True)
        candidates_by_index = {
            candidate.index: candidate
            for candidate in candidates
        }
        artifacts = []
        for index in sorted(candidates_by_index):
            # Stable IDs are scoped by the durable OCR Run and source index,
            # allowing several OCR Segments to reuse one stored frame.
            candidate = candidates_by_index[index]
            frame_id = f"{ocr_run_id}-frame-{index:06d}"
            destination = os.path.join(run_directory, f"{frame_id}.jpg")
            if os.path.exists(destination):
                if self._digest(destination) != self._digest(candidate.path):
                    raise ValueError(
                        f"OCR frame artifact {frame_id} is immutable"
                    )
            else:
                shutil.copyfile(candidate.path, destination)
            artifacts.append(
                OcrFrameArtifact(
                    frame_id=frame_id,
                    source_frame_index=index,
                    timestamp_s=candidate.timestamp,
                    path=destination,
                )
            )
        return tuple(artifacts)

    @staticmethod
    def _digest(path: str) -> str:
        """Hash one artifact incrementally without loading it all into memory."""
        digest = hashlib.sha256()
        with open(path, "rb") as artifact_file:
            # Bounded reads keep verification safe for future larger evidence
            # files while remaining deterministic for the local test adapter.
            for chunk in iter(lambda: artifact_file.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()


class SupabaseOcrFrameArtifactStore:
    """Store immutable OCR frame evidence in one private Supabase bucket."""

    _SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9_-]+$")
    _SAFE_BUCKET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

    def __init__(
        self,
        *,
        supabase_url: str,
        bucket: str,
        session,
        timeout_seconds: float,
    ) -> None:
        if not self._SAFE_BUCKET.fullmatch(bucket):
            raise ValueError("OCR evidence bucket is invalid")
        if timeout_seconds <= 0:
            raise ValueError("OCR evidence storage timeout must be positive")
        self._supabase_url = supabase_url.rstrip("/")
        self._bucket = bucket
        self._session = session
        self._timeout_seconds = timeout_seconds

    def store(
        self,
        *,
        ocr_run_id: str,
        candidates: tuple[OcrCandidate, ...],
    ) -> tuple[OcrFrameArtifact, ...]:
        """Create or verify one durable object per representative source frame."""
        if not self._SAFE_RUN_ID.fullmatch(ocr_run_id):
            raise ValueError("OCR Run ID is unsafe for artifact storage")

        candidates_by_index = {
            candidate.index: candidate
            for candidate in candidates
        }
        artifacts = []
        for index in sorted(candidates_by_index):
            # Deterministic paths let queue redelivery verify the first object
            # instead of overwriting evidence referenced by an OCR Result.
            candidate = candidates_by_index[index]
            frame_id = f"{ocr_run_id}-frame-{index:06d}"
            object_path = (
                f"ocr-runs/{ocr_run_id}/frames/{frame_id}.jpg"
            )
            url = self._object_url(object_path)
            with open(candidate.path, "rb") as candidate_file:
                image_bytes = candidate_file.read()
            try:
                response = self._session.post(
                    url,
                    data=image_bytes,
                    headers={
                        "Content-Type": "image/jpeg",
                        "x-upsert": "false",
                    },
                    timeout=self._timeout_seconds,
                )
            except requests.RequestException:
                # Request exceptions can contain URLs and headers, so preserve
                # only retry meaning at the worker boundary.
                raise TransientError(
                    "OCR evidence storage is temporarily unavailable"
                ) from None
            if response.status_code == 409:
                try:
                    existing = self._session.get(
                        url,
                        timeout=self._timeout_seconds,
                    )
                except requests.RequestException:
                    raise TransientError(
                        "OCR evidence storage is temporarily unavailable"
                    ) from None
                self._raise_for_status(existing.status_code)
                if self._digest_bytes(existing.content) != self._digest_bytes(
                    image_bytes
                ):
                    raise PermanentError(
                        "OCR frame artifact conflicts with immutable evidence"
                    )
            else:
                self._raise_for_status(response.status_code)

            artifacts.append(
                OcrFrameArtifact(
                    frame_id=frame_id,
                    source_frame_index=index,
                    timestamp_s=candidate.timestamp,
                    path=f"{self._bucket}/{object_path}",
                )
            )
        return tuple(artifacts)

    def _object_url(self, object_path: str) -> str:
        """Build one encoded private-object endpoint without signed URLs."""
        encoded_path = "/".join(
            quote(segment, safe="")
            for segment in object_path.split("/")
        )
        return (
            f"{self._supabase_url}/storage/v1/object/"
            f"{quote(self._bucket, safe='')}/{encoded_path}"
        )

    @staticmethod
    def _digest_bytes(content: bytes) -> bytes:
        """Compare object identity without retaining a printable digest."""
        return hashlib.sha256(content).digest()

    @staticmethod
    def _raise_for_status(status_code: int) -> None:
        """Map storage status to a sanitized worker retry category."""
        if 200 <= status_code <= 299:
            return
        if status_code in {408, 429} or status_code >= 500:
            raise TransientError(
                "OCR evidence storage is temporarily unavailable"
            )
        raise PermanentError("OCR evidence storage rejected the request")
