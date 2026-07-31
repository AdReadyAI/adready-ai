"""OCR-owned frame artifact seam and deterministic local adapter."""

from dataclasses import dataclass
import hashlib
import os
import re
import shutil
from typing import Protocol

from analyzer.frame_sampling.probes.ocr_candidates import OcrCandidate


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
