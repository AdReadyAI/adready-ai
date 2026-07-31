"""Public-behavior tests for OCR candidate-mode routing."""

import pytest

from analyzer.ocr.candidates import (
    OcrCandidate,
    OcrCandidateProvenance,
)
from analyzer.ocr.routing import (
    OcrCandidateMode,
    OcrCandidateSimilarity,
    route_ocr_candidates,
)
from analyzer.frame_sampling.probes.text import TextSegment


pytestmark = pytest.mark.unit


def _candidate(
    *,
    index: int,
    provenance: tuple[OcrCandidateProvenance, ...],
) -> OcrCandidate:
    """Build compact source evidence for routing-interface examples."""
    return OcrCandidate(
        index=index,
        timestamp=index / 4,
        model_input=None,
        path=f"/recorded/frame-{index}.jpg",
        source_dimensions=(200, 100),
        encoded_dimensions=(200, 100),
        scale=1.0,
        encoded_bytes=1_000,
        provenance=provenance,
    )


def test_fixed_4fps_routes_every_periodic_candidate_without_fallback() -> None:
    """The recall baseline excludes only change-only optional candidates."""
    periodic = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    combined = _candidate(
        index=4,
        provenance=(
            OcrCandidateProvenance.EDGE_CHANGE,
            OcrCandidateProvenance.PERIODIC,
        ),
    )
    optional = _candidate(
        index=5,
        provenance=(OcrCandidateProvenance.SCENE_CUT,),
    )

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.FIXED_4FPS,
        candidates=(optional, combined, periodic),
        text_segments=(),
    )

    assert decision.requested_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.fallback_applied is False
    assert decision.fallback_reason is None
    assert [candidate.index for candidate in decision.selected_candidates] == [0, 4]


def test_cascade_shadow_preserves_fixed_calls_and_calculates_projection() -> None:
    """Shadow mode compares a conservative cascade without suppressing OCR."""
    periodic_start = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    detector_representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    periodic_end = _candidate(
        index=4,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.25,
        end_s=0.75,
        duration_s=0.5,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_SHADOW,
        candidates=(periodic_end, detector_representative, periodic_start),
        text_segments=(text_segment,),
    )

    assert decision.requested_mode is OcrCandidateMode.CASCADE_SHADOW
    assert decision.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.fallback_applied is False
    assert decision.fallback_reason is None
    assert [candidate.index for candidate in decision.selected_candidates] == [0, 4]
    assert [candidate.index for candidate in decision.cascade_candidates] == [
        0,
        2,
        4,
    ]


def test_cascade_shadow_projects_suppression_but_preserves_fixed_calls() -> None:
    """Shadow measures active savings without changing hosted OCR coverage."""
    periodic_match = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    unrelated_periodic = _candidate(
        index=4,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.75,
        duration_s=0.75,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_SHADOW,
        candidates=(unrelated_periodic, representative, periodic_match),
        text_segments=(text_segment,),
        compare_candidates=lambda candidate, reference, segment: (
            OcrCandidateSimilarity(
                spatial_overlap=0.99,
                geometry_similarity=0.99,
                perceptual_hash_similarity=0.99,
                edge_signature_similarity=0.99,
            )
        ),
    )

    assert decision.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.fallback_applied is False
    assert decision.fallback_reason is None
    assert [candidate.index for candidate in decision.selected_candidates] == [
        0,
        4,
    ]
    assert [candidate.index for candidate in decision.cascade_candidates] == [
        2,
        4,
    ]


def test_cascade_shadow_comparison_failure_discards_projection() -> None:
    """Failed shadow evidence records fallback without changing fixed calls."""
    periodic = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.75,
        duration_s=0.75,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    def fail_comparison(candidate, reference, segment):
        """Represent failure of the diagnostic shadow calculation."""
        raise RuntimeError("comparison failed")

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_SHADOW,
        candidates=(representative, periodic),
        text_segments=(text_segment,),
        compare_candidates=fail_comparison,
    )

    assert decision.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.fallback_applied is True
    assert decision.fallback_reason == "candidate_comparison_failed"
    assert [candidate.index for candidate in decision.selected_candidates] == [0]
    assert decision.cascade_candidates == decision.selected_candidates


def test_cascade_active_conservatively_routes_complete_candidate_union() -> None:
    """Active mode starts safely by retaining every available route candidate."""
    periodic_start = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    detector_representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    periodic_end = _candidate(
        index=4,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.25,
        end_s=0.75,
        duration_s=0.5,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        candidates=(
            periodic_end,
            detector_representative,
            periodic_start,
            detector_representative,
        ),
        text_segments=(text_segment,),
    )

    assert decision.requested_mode is OcrCandidateMode.CASCADE_ACTIVE
    assert decision.effective_mode is OcrCandidateMode.CASCADE_ACTIVE
    assert decision.fallback_applied is False
    assert decision.fallback_reason is None
    assert [candidate.index for candidate in decision.selected_candidates] == [
        0,
        2,
        4,
    ]
    assert decision.cascade_candidates == decision.selected_candidates


def test_cascade_active_suppresses_only_complete_high_confidence_match() -> None:
    """All four independent signals are required to skip a periodic OCR call."""
    periodic_match = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    detector_representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    unrelated_periodic = _candidate(
        index=4,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.75,
        duration_s=0.75,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    def compare_candidates(candidate, representative, segment):
        """Return recorded high-confidence sameness for the in-segment pair."""
        assert candidate.index == 0
        assert representative.index == 2
        assert segment is text_segment
        return OcrCandidateSimilarity(
            spatial_overlap=0.99,
            geometry_similarity=0.99,
            perceptual_hash_similarity=0.99,
            edge_signature_similarity=0.99,
        )

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        candidates=(
            unrelated_periodic,
            detector_representative,
            periodic_match,
        ),
        text_segments=(text_segment,),
        compare_candidates=compare_candidates,
    )

    assert [candidate.index for candidate in decision.selected_candidates] == [
        2,
        4,
    ]
    assert [candidate.index for candidate in decision.cascade_candidates] == [
        2,
        4,
    ]


@pytest.mark.parametrize(
    ("uncertain_signal", "uncertain_value"),
    (
        ("spatial_overlap", None),
        ("spatial_overlap", 0.94),
        ("geometry_similarity", None),
        ("geometry_similarity", 0.94),
        ("perceptual_hash_similarity", None),
        ("perceptual_hash_similarity", 0.94),
        ("edge_signature_similarity", None),
        ("edge_signature_similarity", 0.94),
    ),
)
def test_cascade_active_retains_call_when_any_signal_is_uncertain(
    uncertain_signal,
    uncertain_value,
) -> None:
    """Missing or weak evidence from any signal must preserve OCR recall."""
    periodic = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    text_segment = TextSegment(
        identifier="text_segment_0001",
        start_s=0.0,
        end_s=0.75,
        duration_s=0.75,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )
    signals = {
        "spatial_overlap": 0.99,
        "geometry_similarity": 0.99,
        "perceptual_hash_similarity": 0.99,
        "edge_signature_similarity": 0.99,
    }
    signals[uncertain_signal] = uncertain_value

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        candidates=(representative, periodic),
        text_segments=(text_segment,),
        compare_candidates=lambda candidate, reference, segment: (
            OcrCandidateSimilarity(**signals)
        ),
    )

    assert [candidate.index for candidate in decision.selected_candidates] == [
        0,
        2,
    ]


def test_cascade_active_retains_call_for_ambiguous_segment_association() -> None:
    """Multiple possible representatives cannot justify suppressing OCR."""
    periodic = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    first_representative = _candidate(
        index=1,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    second_representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.SCENE_CUT,),
    )
    segments = tuple(
        TextSegment(
            identifier=f"text_segment_{index:04d}",
            start_s=0.0,
            end_s=0.5,
            duration_s=0.5,
            rectangle=rectangle,
            detector_confidence=0.9,
            representative_frame_index=index,
            candidate_sources=(source,),
            missed_observations=0,
            timing_uncertainty_s=0.0,
        )
        for index, rectangle, source in (
            (1, (0.1, 0.1, 0.3, 0.2), "edge_change"),
            (2, (0.6, 0.6, 0.3, 0.2), "scene_cut"),
        )
    )

    def reject_comparison(candidate, representative, segment):
        """Fail if routing compares evidence with an ambiguous owner."""
        raise AssertionError("ambiguous candidate must not be compared")

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        candidates=(
            second_representative,
            periodic,
            first_representative,
        ),
        text_segments=segments,
        compare_candidates=reject_comparison,
    )

    assert [candidate.index for candidate in decision.selected_candidates] == [
        0,
        1,
        2,
    ]


def test_cascade_active_comparison_failure_atomically_falls_back_to_fixed() -> None:
    """A late safety failure discards every partial active-route decision."""
    periodic_start = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    first_representative = _candidate(
        index=1,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    periodic_end = _candidate(
        index=4,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    second_representative = _candidate(
        index=5,
        provenance=(OcrCandidateProvenance.SCENE_CUT,),
    )
    segments = tuple(
        TextSegment(
            identifier=f"text_segment_{position:04d}",
            start_s=start_s,
            end_s=end_s,
            duration_s=end_s - start_s,
            rectangle=(0.1, 0.1, 0.4, 0.2),
            detector_confidence=0.9,
            representative_frame_index=representative_index,
            candidate_sources=(source,),
            missed_observations=0,
            timing_uncertainty_s=0.0,
        )
        for position, start_s, end_s, representative_index, source in (
            (1, 0.0, 0.3, 1, "edge_change"),
            (2, 0.9, 1.3, 5, "scene_cut"),
        )
    )

    def compare_candidates(candidate, representative, segment):
        """Fail after one earlier comparison looked safe to suppress."""
        if candidate.index == 4:
            raise RuntimeError("comparison backend failed")
        return OcrCandidateSimilarity(
            spatial_overlap=0.99,
            geometry_similarity=0.99,
            perceptual_hash_similarity=0.99,
            edge_signature_similarity=0.99,
        )

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        candidates=(
            second_representative,
            periodic_end,
            first_representative,
            periodic_start,
        ),
        text_segments=segments,
        compare_candidates=compare_candidates,
    )

    assert decision.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.fallback_applied is True
    assert decision.fallback_reason == "candidate_comparison_failed"
    assert [candidate.index for candidate in decision.selected_candidates] == [
        0,
        4,
    ]
    assert decision.cascade_candidates == decision.selected_candidates


def test_cascade_active_preexisting_failure_skips_partial_cascade() -> None:
    """Upstream cascade failure restores fixed routing before comparison."""
    periodic = _candidate(
        index=0,
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    representative = _candidate(
        index=2,
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    partial_segment = TextSegment(
        identifier="text_segment_partial",
        start_s=0.0,
        end_s=0.5,
        duration_s=0.5,
        rectangle=(0.1, 0.1, 0.4, 0.2),
        detector_confidence=0.9,
        representative_frame_index=2,
        candidate_sources=("edge_change",),
        missed_observations=0,
        timing_uncertainty_s=0.0,
    )

    def reject_comparison(candidate, reference, segment):
        """Fail if routing consults evidence from a failed partial cascade."""
        raise AssertionError("partial cascade must not be compared")

    decision = route_ocr_candidates(
        requested_mode=OcrCandidateMode.CASCADE_ACTIVE,
        candidates=(representative, periodic),
        text_segments=(partial_segment,),
        compare_candidates=reject_comparison,
        cascade_failure_reason="detector_failed",
    )

    assert decision.effective_mode is OcrCandidateMode.FIXED_4FPS
    assert decision.fallback_applied is True
    assert decision.fallback_reason == "detector_failed"
    assert [candidate.index for candidate in decision.selected_candidates] == [0]
    assert decision.cascade_candidates == decision.selected_candidates
