"""Disk-backed candidates owned by detector-only TextProbe processing."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import numpy as np

from analyzer.frame_sampling.candidate_storage import (
    CandidateStorageCapacityError,
    DiskCandidateStorage,
    StoredFrameCandidate,
)


class TextCandidateCapacityError(RuntimeError):
    """Required periodic text-detection coverage exceeds configured limits."""


class TextCandidateProvenance(StrEnum):
    """Signals that select one source frame for text-region detection."""

    PERIODIC = "periodic"
    EDGE_CHANGE = "edge_change"
    SCENE_CUT = "scene_cut"


@dataclass(frozen=True)
class TextCandidate:
    """One disk-backed source frame awaiting text-region detection."""

    index: int
    timestamp: float
    model_input: Any
    path: str
    source_dimensions: tuple[int, int]
    encoded_dimensions: tuple[int, int]
    scale: float
    encoded_bytes: int
    provenance: tuple[TextCandidateProvenance, ...]


@dataclass(frozen=True)
class TextCandidateStats:
    """Text candidate admission, drop, and eviction totals."""

    accepted_count: int = 0
    accepted_bytes: int = 0
    dropped_count: int = 0
    dropped_bytes: int = 0
    evicted_count: int = 0
    evicted_bytes: int = 0


class TextCandidateStore:
    """Protect bounded periodic EAST coverage in a text-owned directory."""

    def __init__(
        self,
        *,
        work_dir: str,
        reserved_periodic_count: int = 0,
        max_candidates: int = 600,
        max_bytes: int = 1_000_000_000,
    ) -> None:
        self._storage = DiskCandidateStorage(
            work_dir=work_dir,
            directory_prefix="text-candidates-",
            required_provenance=TextCandidateProvenance.PERIODIC.value,
            required_count=reserved_periodic_count,
            max_candidates=max_candidates,
            max_bytes=max_bytes,
        )

    @property
    def stats(self) -> TextCandidateStats:
        """Return an immutable text-domain view of current storage totals."""
        stats = self._storage.stats
        return TextCandidateStats(
            accepted_count=stats.accepted_count,
            accepted_bytes=stats.accepted_bytes,
            dropped_count=stats.dropped_count,
            dropped_bytes=stats.dropped_bytes,
            evicted_count=stats.evicted_count,
            evicted_bytes=stats.evicted_bytes,
        )

    def admit(
        self,
        *,
        index: int,
        timestamp: float,
        source_frame: np.ndarray,
        model_input: Any,
        provenance: tuple[TextCandidateProvenance, ...],
    ) -> TextCandidate | None:
        """Encode one source frame and return text-owned candidate evidence."""
        try:
            candidate = self._storage.admit(
                index=index,
                timestamp=timestamp,
                source_frame=source_frame,
                model_input=model_input,
                provenance=tuple(source.value for source in provenance),
            )
        except CandidateStorageCapacityError as exc:
            raise TextCandidateCapacityError(
                "Periodic text-detection coverage exceeds candidate capacity"
            ) from exc
        return self._to_text_candidate(candidate) if candidate else None

    def candidates(self) -> tuple[TextCandidate, ...]:
        """Return deterministic text candidates in source-frame order."""
        return tuple(
            self._to_text_candidate(candidate)
            for candidate in self._storage.candidates()
        )

    def cleanup(self) -> None:
        """Remove every temporary text candidate owned by this run."""
        self._storage.cleanup()

    @staticmethod
    def _to_text_candidate(
        candidate: StoredFrameCandidate,
    ) -> TextCandidate:
        """Translate private storage data into the TextProbe interface."""
        return TextCandidate(
            index=candidate.index,
            timestamp=candidate.timestamp,
            model_input=candidate.model_input,
            path=candidate.path,
            source_dimensions=candidate.source_dimensions,
            encoded_dimensions=candidate.encoded_dimensions,
            scale=candidate.scale,
            encoded_bytes=candidate.encoded_bytes,
            provenance=tuple(
                TextCandidateProvenance(source)
                for source in candidate.provenance
            ),
        )
