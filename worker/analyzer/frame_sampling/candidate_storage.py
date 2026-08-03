"""Private bounded disk storage shared by domain-specific candidate stores."""

from dataclasses import dataclass, replace
import os
import shutil
import tempfile
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True)
class StoredFrameCandidate:
    """Encoded source-frame data without text- or OCR-specific semantics."""

    index: int
    timestamp: float
    model_input: Any
    path: str
    source_dimensions: tuple[int, int]
    encoded_dimensions: tuple[int, int]
    scale: float
    encoded_bytes: int
    provenance: tuple[str, ...]


@dataclass
class CandidateStorageStats:
    """Cumulative admission, drop, and eviction totals for one store."""

    accepted_count: int = 0
    accepted_bytes: int = 0
    dropped_count: int = 0
    dropped_bytes: int = 0
    evicted_count: int = 0
    evicted_bytes: int = 0


class CandidateStorageCapacityError(RuntimeError):
    """Required candidate coverage cannot fit within configured limits."""


class DiskCandidateStorage:
    """Encode bounded source frames while protecting required coverage.

    Domain-specific stores translate their provenance into strings before
    crossing this private seam and translate stored records back on return.
    """

    _LONG_SIDE_LIMIT = 1920
    _JPEG_QUALITY = 95

    def __init__(
        self,
        *,
        work_dir: str,
        directory_prefix: str,
        required_provenance: str,
        required_count: int = 0,
        max_candidates: int = 600,
        max_bytes: int = 1_000_000_000,
    ) -> None:
        os.makedirs(work_dir, exist_ok=True)
        self._directory = tempfile.mkdtemp(
            prefix=directory_prefix,
            dir=work_dir,
        )
        self._required_provenance = required_provenance
        self._remaining_required = required_count
        self._max_candidates = max_candidates
        self._max_bytes = max_bytes
        self._candidates: dict[int, StoredFrameCandidate] = {}
        self._current_bytes = 0
        self.stats = CandidateStorageStats()

    def admit(
        self,
        *,
        index: int,
        timestamp: float,
        source_frame: np.ndarray,
        model_input: Any,
        provenance: tuple[str, ...],
    ) -> StoredFrameCandidate | None:
        """Encode one candidate or coalesce it with an existing source frame."""
        existing = self._candidates.get(index)
        if existing is not None:
            adds_required = (
                self._required_provenance in provenance
                and self._required_provenance not in existing.provenance
            )
            coalesced = replace(
                existing,
                provenance=tuple(
                    dict.fromkeys(existing.provenance + provenance)
                ),
            )
            self._candidates[index] = coalesced
            if adds_required:
                self._remaining_required = max(
                    0,
                    self._remaining_required - 1,
                )
            return coalesced

        encoded_frame, scale = self._bounded_frame(source_frame)
        encoded = self._encode_jpeg(encoded_frame)
        encoded_bytes = len(encoded)
        is_required = self._required_provenance in provenance

        # Required coverage may evict several optional candidates until both
        # its frame slot and its actual encoded bytes fit within the run.
        while (
            is_required
            and not self._has_capacity(
                encoded_bytes=encoded_bytes,
                is_required=True,
            )
            and self._evict_optional()
        ):
            pass
        if not self._has_capacity(
            encoded_bytes=encoded_bytes,
            is_required=is_required,
        ):
            self.stats.dropped_count += 1
            self.stats.dropped_bytes += encoded_bytes
            if is_required:
                self.cleanup()
                raise CandidateStorageCapacityError(
                    "Required candidate coverage exceeds storage capacity"
                )
            return None

        path = os.path.join(self._directory, f"{index:06d}.jpg")
        with open(path, "wb") as candidate_file:
            candidate_file.write(encoded)

        source_height, source_width = source_frame.shape[:2]
        encoded_height, encoded_width = encoded_frame.shape[:2]
        candidate = StoredFrameCandidate(
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
        if is_required:
            self._remaining_required = max(
                0,
                self._remaining_required - 1,
            )
        self.stats.accepted_count += 1
        self.stats.accepted_bytes += encoded_bytes
        return candidate

    def candidates(self) -> tuple[StoredFrameCandidate, ...]:
        """Return candidates in deterministic source-frame order."""
        return tuple(
            self._candidates[index]
            for index in sorted(self._candidates)
        )

    def cleanup(self) -> None:
        """Remove every temporary artifact owned by this store."""
        shutil.rmtree(self._directory, ignore_errors=True)
        self._candidates.clear()
        self._current_bytes = 0

    def _has_capacity(
        self,
        *,
        encoded_bytes: int,
        is_required: bool,
    ) -> bool:
        """Protect required slots and enforce actual encoded-byte capacity."""
        protected_slots = (
            0 if is_required else self._remaining_required
        )
        has_frame_capacity = (
            len(self._candidates) + protected_slots
            < self._max_candidates
        )
        has_byte_capacity = (
            self._current_bytes + encoded_bytes <= self._max_bytes
        )
        return has_frame_capacity and has_byte_capacity

    def _evict_optional(self) -> bool:
        """Remove the newest candidate lacking required provenance."""
        eligible = [
            candidate
            for candidate in self._candidates.values()
            if self._required_provenance not in candidate.provenance
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
        sampling_key = getattr(
            cv2,
            "IMWRITE_JPEG_SAMPLING_FACTOR",
            None,
        )
        sampling_444 = getattr(
            cv2,
            "IMWRITE_JPEG_SAMPLING_FACTOR_444",
            None,
        )
        if sampling_key is not None and sampling_444 is not None:
            parameters.extend((sampling_key, sampling_444))

        encoded_ok, encoded = cv2.imencode(".jpg", frame, parameters)
        if not encoded_ok:
            raise ValueError("Could not encode source candidate as JPEG")
        return encoded.tobytes()
