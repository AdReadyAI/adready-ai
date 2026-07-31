"""Select complete source candidates for OCR through explicit run modes."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Callable

from analyzer.ocr.candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.frame_sampling.probes.text import TextSegment


class OcrCandidateMode(StrEnum):
    """Requested and effective OCR candidate-routing behavior."""

    FIXED_4FPS = "fixed_4fps"
    CASCADE_SHADOW = "cascade_shadow"
    CASCADE_ACTIVE = "cascade_active"


@dataclass(frozen=True)
class OcrRoutingDecision:
    """One complete candidate decision ready for OCR recognition."""

    requested_mode: OcrCandidateMode
    effective_mode: OcrCandidateMode
    fallback_applied: bool
    fallback_reason: str | None
    selected_candidates: tuple[OcrCandidate, ...]
    cascade_candidates: tuple[OcrCandidate, ...]


@dataclass(frozen=True)
class OcrCandidateSimilarity:
    """Independent evidence that two OCR candidate regions show the same text."""

    spatial_overlap: float | None
    geometry_similarity: float | None
    perceptual_hash_similarity: float | None
    edge_signature_similarity: float | None


OcrCandidateComparator = Callable[
    [OcrCandidate, OcrCandidate, TextSegment],
    OcrCandidateSimilarity,
]

_HIGH_CONFIDENCE_SIMILARITY = 0.95


def route_ocr_candidates(
    *,
    requested_mode: OcrCandidateMode,
    candidates: tuple[OcrCandidate, ...],
    text_segments: tuple[TextSegment, ...],
    compare_candidates: OcrCandidateComparator | None = None,
    cascade_failure_reason: str | None = None,
) -> OcrRoutingDecision:
    """Return one atomic OCR candidate decision for the requested mode."""
    candidates_by_index = {
        candidate.index: candidate
        for candidate in candidates
    }
    ordered_candidates = tuple(
        candidates_by_index[index]
        for index in sorted(candidates_by_index)
    )
    periodic_candidates = tuple(
        candidate
        for candidate in ordered_candidates
        if OcrCandidateProvenance.PERIODIC in candidate.provenance
    )
    cascade_mode_requested = requested_mode in {
        OcrCandidateMode.CASCADE_SHADOW,
        OcrCandidateMode.CASCADE_ACTIVE,
    }
    if cascade_mode_requested and cascade_failure_reason is not None:
        # Upstream failure invalidates every partial Text Segment and cascade
        # decision, while the independently reserved periodic route remains safe.
        return OcrRoutingDecision(
            requested_mode=requested_mode,
            effective_mode=OcrCandidateMode.FIXED_4FPS,
            fallback_applied=True,
            fallback_reason=cascade_failure_reason,
            selected_candidates=periodic_candidates,
            cascade_candidates=periodic_candidates,
        )

    if cascade_mode_requested:
        representative_indexes = {
            segment.representative_frame_index
            for segment in text_segments
        }
        cascade_candidates = tuple(
            candidate
            for candidate in ordered_candidates
            if (
                OcrCandidateProvenance.PERIODIC in candidate.provenance
                or candidate.index in representative_indexes
            )
        )
    else:
        # Fixed routing deliberately ignores detector-only Text Segments so the
        # recall baseline stays independent of the cascade.
        cascade_candidates = periodic_candidates

    if cascade_mode_requested:
        try:
            # Materialize the complete cascade projection before exposing it so a
            # late comparison failure cannot leak earlier suppressions.
            projected_candidates = tuple(
                candidate
                for candidate in cascade_candidates
                if not _is_redundant_periodic_candidate(
                    candidate=candidate,
                    candidates_by_index=candidates_by_index,
                    text_segments=text_segments,
                    compare_candidates=compare_candidates,
                )
            )
        except Exception:
            effective_mode = OcrCandidateMode.FIXED_4FPS
            selected_candidates = periodic_candidates
            cascade_candidates = periodic_candidates
            fallback_applied = True
            fallback_reason = "candidate_comparison_failed"
        else:
            cascade_candidates = projected_candidates
            fallback_applied = False
            fallback_reason = None
            if requested_mode is OcrCandidateMode.CASCADE_ACTIVE:
                effective_mode = OcrCandidateMode.CASCADE_ACTIVE
                selected_candidates = projected_candidates
            else:
                # Shadow exposes the projected route for comparison while every
                # periodic candidate still crosses the hosted OCR boundary.
                effective_mode = OcrCandidateMode.FIXED_4FPS
                selected_candidates = periodic_candidates
    else:
        effective_mode = OcrCandidateMode.FIXED_4FPS
        selected_candidates = periodic_candidates
        fallback_applied = False
        fallback_reason = None

    return OcrRoutingDecision(
        requested_mode=requested_mode,
        effective_mode=effective_mode,
        fallback_applied=fallback_applied,
        fallback_reason=fallback_reason,
        selected_candidates=selected_candidates,
        cascade_candidates=cascade_candidates,
    )


def _is_redundant_periodic_candidate(
    *,
    candidate: OcrCandidate,
    candidates_by_index: dict[int, OcrCandidate],
    text_segments: tuple[TextSegment, ...],
    compare_candidates: OcrCandidateComparator | None,
) -> bool:
    """Suppress only one unambiguous periodic match with complete evidence."""
    if (
        OcrCandidateProvenance.PERIODIC not in candidate.provenance
        or compare_candidates is None
    ):
        return False

    matching_segments = tuple(
        segment
        for segment in text_segments
        if segment.start_s <= candidate.timestamp <= segment.end_s
        and segment.representative_frame_index != candidate.index
    )
    if len(matching_segments) != 1:
        # Zero or multiple associations cannot safely identify authoritative
        # representative evidence, so active routing preserves the OCR call.
        return False

    segment = matching_segments[0]
    representative = candidates_by_index.get(
        segment.representative_frame_index
    )
    if representative is None:
        return False

    similarity = compare_candidates(candidate, representative, segment)
    signals = (
        similarity.spatial_overlap,
        similarity.geometry_similarity,
        similarity.perceptual_hash_similarity,
        similarity.edge_signature_similarity,
    )
    return all(
        signal is not None
        and signal >= _HIGH_CONFIDENCE_SIMILARITY
        for signal in signals
    )
