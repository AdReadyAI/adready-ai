"""Disk-backed source candidates owned exclusively by OCR Media Processing."""

from dataclasses import dataclass, replace
from enum import StrEnum
import os
import shutil
import tempfile
from typing import Any

import cv2
import numpy as np


class OcrCandidateCapacityError(RuntimeError):
    """Required periodic OCR coverage cannot fit within configured limits."""


class OcrCandidateProvenance(StrEnum):
    """Signals that can select one source frame for OCR detection."""

    PERIODIC = "periodic"
    EDGE_CHANGE = "edge_change"
    SCENE_CUT = "scene_cut"


@dataclass(frozen=True)
class OcrCandidate:
    """Metadata and disk location for one OCR source frame."""

    index: int
    timestamp: float
    model_input: Any
    path: str
    source_dimensions: tuple[int, int]
    encoded_dimensions: tuple[int, int]
    scale: float
    encoded_bytes: int
    provenance: tuple[OcrCandidateProvenance, ...]


@dataclass
class OcrCandidateStats:
    """Cumulative OCR candidate admission counts and encoded bytes."""

    accepted_count: int = 0
    accepted_bytes: int = 0
    dropped_count: int = 0
    dropped_bytes: int = 0
    evicted_count: int = 0
    evicted_bytes: int = 0


class OcrCandidateStore:
    """Encode OCR source frames into an isolated Media Processing directory."""

    _LONG_SIDE_LIMIT = 1920
    _JPEG_QUALITY = 95

    def __init__(
        self,
        work_dir: str,
        max_candidates: int = 600,
        max_bytes: int = 1_000_000_000,
        reserved_periodic_count: int = 0,
    ) -> None:
        os.makedirs(work_dir, exist_ok=True)
        self._directory = tempfile.mkdtemp(
            prefix="ocr-candidates-",
            dir=work_dir,
        )
        self._max_candidates = max_candidates
        self._max_bytes = max_bytes
        self._remaining_periodic = reserved_periodic_count
        self._candidates: dict[int, OcrCandidate] = {}
        self._current_bytes = 0
        self.stats = OcrCandidateStats()

    def admit(
        self,
        *,
        index: int,
        timestamp: float,
        source_frame: np.ndarray,
        model_input: Any,
        provenance: tuple[OcrCandidateProvenance, ...],
    ) -> OcrCandidate | None:
        """Encode one frame and return its traceable disk-backed record."""
        existing = self._candidates.get(index)
        # If the same source frame is admitted multiple times, coalesce provenance
        if existing is not None:
            adds_periodic = (
                OcrCandidateProvenance.PERIODIC in provenance
                and OcrCandidateProvenance.PERIODIC
                not in existing.provenance
            )
            merged_provenance = tuple(
                dict.fromkeys(existing.provenance + provenance)
            )
            coalesced = replace(
                existing,
                provenance=merged_provenance,
            )
            self._candidates[index] = coalesced
            if adds_periodic:
                self._remaining_periodic = max(
                    0,
                    self._remaining_periodic - 1,
                )
            return coalesced

        encoded_frame, scale = self._bounded_frame(source_frame)
        encoded = self._encode_jpeg(encoded_frame)
        encoded_bytes = len(encoded)
        is_periodic = OcrCandidateProvenance.PERIODIC in provenance
        # Later periodic evidence may reclaim multiple optional candidates
        # until both its frame slot and actual encoded bytes fit.
        while (
            is_periodic
            and not self._has_capacity(
                encoded_bytes=encoded_bytes,
                is_periodic=True,
            )
            and self._evict_change_only()
        ):
            pass
        if not self._has_capacity(
            encoded_bytes=encoded_bytes,
            is_periodic=is_periodic,
        ):
            self.stats.dropped_count += 1
            self.stats.dropped_bytes += encoded_bytes
            if is_periodic:
                self.cleanup()
                raise OcrCandidateCapacityError(
                    "Ad Creative is unsupported because periodic OCR coverage "
                    "exceeds candidate capacity"
                )
            return None

        path = os.path.join(self._directory, f"{index:06d}.jpg")
        with open(path, "wb") as candidate_file:
            candidate_file.write(encoded)

        source_height, source_width = source_frame.shape[:2]
        encoded_height, encoded_width = encoded_frame.shape[:2]
        candidate = OcrCandidate(
            index=index,
            timestamp=timestamp,
            model_input=model_input,
            path=path,
            source_dimensions=(source_width, source_height),
            encoded_dimensions=(encoded_width, encoded_height),
            scale=scale,
            encoded_bytes=encoded_bytes,
            provenance=provenance,
        )
        self._candidates[index] = candidate
        self._current_bytes += encoded_bytes
        if is_periodic:
            self._remaining_periodic = max(
                0,
                self._remaining_periodic - 1,
            )
        self.stats.accepted_count += 1
        self.stats.accepted_bytes += encoded_bytes
        return candidate

    def candidates(self) -> tuple[OcrCandidate, ...]:
        """Return coalesced candidates in deterministic source-frame order."""
        return tuple(
            self._candidates[index]
            for index in sorted(self._candidates)
        )

    def cleanup(self) -> None:
        """Remove all temporary candidates owned by this OCR candidate run."""
        shutil.rmtree(self._directory, ignore_errors=True)
        self._candidates.clear()
        self._current_bytes = 0

    def _has_capacity(
        self,
        *,
        encoded_bytes: int,
        is_periodic: bool,
    ) -> bool:
        """Protect periodic slots and enforce actual encoded-byte capacity."""
        protected_slots = 0 if is_periodic else self._remaining_periodic
        has_frame_capacity = (
            len(self._candidates) + protected_slots < self._max_candidates
        )
        has_byte_capacity = (
            self._current_bytes + encoded_bytes <= self._max_bytes
        )
        return has_frame_capacity and has_byte_capacity

    def _evict_change_only(self) -> bool:
        """Remove the newest candidate that contributes no periodic coverage."""
        eligible = [
            candidate
            for candidate in self._candidates.values()
            if OcrCandidateProvenance.PERIODIC
            not in candidate.provenance
        ]
        if not eligible:
            return False

        evicted = max(eligible, key=lambda candidate: candidate.index)
        self._candidates.pop(evicted.index)
        self._current_bytes -= evicted.encoded_bytes
        self.stats.evicted_count += 1
        self.stats.evicted_bytes += evicted.encoded_bytes
        try:
            os.remove(evicted.path)
        except FileNotFoundError:
            pass
        return True

    @classmethod
    def _bounded_frame(
        cls,
        source_frame: np.ndarray,
    ) -> tuple[np.ndarray, float]:
        """Preserve aspect ratio, avoid upscaling, and cap the long side."""
        height, width = source_frame.shape[:2]
        scale = min(1.0, cls._LONG_SIDE_LIMIT / max(height, width))
        if scale == 1.0:
            return source_frame, scale

        dimensions = (round(width * scale), round(height * scale))
        bounded = cv2.resize(
            source_frame,
            dimensions,
            interpolation=cv2.INTER_AREA,
        )
        return bounded, scale

    @classmethod
    def _encode_jpeg(cls, frame: np.ndarray) -> bytes:
        """Encode quality-95 JPEG with minimal chroma subsampling if supported."""
        parameters = [cv2.IMWRITE_JPEG_QUALITY, cls._JPEG_QUALITY]
        sampling_key = getattr(cv2, "IMWRITE_JPEG_SAMPLING_FACTOR", None)
        sampling_444 = getattr(
            cv2,
            "IMWRITE_JPEG_SAMPLING_FACTOR_444",
            None,
        )
        if sampling_key is not None and sampling_444 is not None:
            parameters.extend((sampling_key, sampling_444))

        encoded_ok, encoded = cv2.imencode(".jpg", frame, parameters)
        if not encoded_ok:
            raise ValueError("Could not encode OCR source candidate as JPEG")
        return encoded.tobytes()
