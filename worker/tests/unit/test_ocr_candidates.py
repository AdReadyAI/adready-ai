"""Public-behavior tests for disk-backed OCR source candidates."""

import os

import numpy as np
import pytest

from analyzer.frame_sampling.probes.ocr_candidates import (
    OcrCandidateCapacityError,
    OcrCandidateProvenance,
    OcrCandidateStore,
)

pytestmark = pytest.mark.unit


def test_admitted_candidate_is_bounded_disk_backed_source_evidence(tmp_path):
    """Admission preserves source metadata without retaining full-size pixels."""
    store = OcrCandidateStore(work_dir=str(tmp_path))
    source_frame = np.zeros((2160, 3840, 3), dtype=np.uint8)

    candidate = store.admit(
        index=7,
        timestamp=0.7,
        source_frame=source_frame,
        model_input="analysis-frame-7",
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )

    assert candidate is not None
    assert not hasattr(candidate, "frame")
    assert candidate.source_dimensions == (3840, 2160)
    assert candidate.encoded_dimensions == (1920, 1080)
    assert candidate.scale == 0.5
    assert candidate.encoded_bytes == os.path.getsize(candidate.path)
    assert candidate.provenance == (OcrCandidateProvenance.EDGE_CHANGE,)
    assert os.path.dirname(candidate.path).startswith(str(tmp_path))
    assert os.path.basename(os.path.dirname(candidate.path)).startswith(
        "ocr-candidates-"
    )


def test_candidate_never_upscales_small_source_frame(tmp_path):
    """OCR storage preserves native dimensions below the long-side limit."""
    store = OcrCandidateStore(work_dir=str(tmp_path))
    source_frame = np.zeros((360, 640, 3), dtype=np.uint8)

    candidate = store.admit(
        index=0,
        timestamp=0.0,
        source_frame=source_frame,
        model_input="analysis-frame-0",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    assert candidate is not None
    assert candidate.source_dimensions == (640, 360)
    assert candidate.encoded_dimensions == (640, 360)
    assert candidate.scale == 1.0


def test_repeated_frame_index_coalesces_provenance_and_storage(tmp_path):
    """Multiple selection paths share one source candidate and one JPEG."""
    store = OcrCandidateStore(work_dir=str(tmp_path))
    source_frame = np.zeros((100, 200, 3), dtype=np.uint8)

    change_candidate = store.admit(
        index=7,
        timestamp=0.7,
        source_frame=source_frame,
        model_input="analysis-frame-7",
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    periodic_candidate = store.admit(
        index=7,
        timestamp=0.7,
        source_frame=source_frame,
        model_input="analysis-frame-7",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    candidates = store.candidates()
    assert len(candidates) == 1
    assert change_candidate.path == periodic_candidate.path
    assert candidates[0].provenance == (
        OcrCandidateProvenance.EDGE_CHANGE,
        OcrCandidateProvenance.PERIODIC,
    )
    candidate_directory = os.path.dirname(candidates[0].path)
    assert os.listdir(candidate_directory) == ["000007.jpg"]


def test_change_only_admission_preserves_reserved_periodic_slots(tmp_path):
    """Opportunistic candidates cannot consume future periodic coverage."""
    store = OcrCandidateStore(
        work_dir=str(tmp_path),
        max_candidates=2,
        reserved_periodic_count=1,
    )
    source_frame = np.zeros((100, 200, 3), dtype=np.uint8)

    accepted = store.admit(
        index=0,
        timestamp=0.0,
        source_frame=source_frame,
        model_input="analysis-frame-0",
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    dropped = store.admit(
        index=1,
        timestamp=0.1,
        source_frame=source_frame,
        model_input="analysis-frame-1",
        provenance=(OcrCandidateProvenance.SCENE_CUT,),
    )

    assert accepted is not None
    assert dropped is None
    assert [candidate.index for candidate in store.candidates()] == [0]
    assert store.stats.accepted_count == 1
    assert store.stats.accepted_bytes == accepted.encoded_bytes
    assert store.stats.dropped_count == 1
    assert store.stats.dropped_bytes > 0


def test_later_periodic_candidate_evicts_change_only_candidate(tmp_path):
    """Required periodic coverage reclaims capacity from optional changes."""
    store = OcrCandidateStore(
        work_dir=str(tmp_path),
        max_candidates=2,
        reserved_periodic_count=1,
    )
    source_frame = np.zeros((100, 200, 3), dtype=np.uint8)

    change_candidate = store.admit(
        index=1,
        timestamp=0.1,
        source_frame=source_frame,
        model_input="analysis-frame-1",
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    store.admit(
        index=0,
        timestamp=0.0,
        source_frame=source_frame,
        model_input="analysis-frame-0",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    later_periodic = store.admit(
        index=2,
        timestamp=0.2,
        source_frame=source_frame,
        model_input="analysis-frame-2",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    assert change_candidate is not None
    assert later_periodic is not None
    assert [candidate.index for candidate in store.candidates()] == [0, 2]
    assert not os.path.exists(change_candidate.path)
    assert store.stats.evicted_count == 1
    assert store.stats.evicted_bytes == change_candidate.encoded_bytes


def test_periodic_candidate_evicts_change_only_candidate_for_byte_capacity(
    tmp_path,
):
    """Actual JPEG bytes enforce the ceiling while preserving periodic frames."""
    source_frame = np.zeros((100, 200, 3), dtype=np.uint8)
    calibration_store = OcrCandidateStore(
        work_dir=str(tmp_path / "calibration"),
    )
    calibration_candidate = calibration_store.admit(
        index=0,
        timestamp=0.0,
        source_frame=source_frame,
        model_input="calibration",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    assert calibration_candidate is not None
    byte_limit = calibration_candidate.encoded_bytes * 2

    store = OcrCandidateStore(
        work_dir=str(tmp_path / "bounded"),
        max_candidates=3,
        max_bytes=byte_limit,
        reserved_periodic_count=1,
    )
    change_candidate = store.admit(
        index=1,
        timestamp=0.1,
        source_frame=source_frame,
        model_input="analysis-frame-1",
        provenance=(OcrCandidateProvenance.EDGE_CHANGE,),
    )
    store.admit(
        index=0,
        timestamp=0.0,
        source_frame=source_frame,
        model_input="analysis-frame-0",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )
    later_periodic = store.admit(
        index=2,
        timestamp=0.2,
        source_frame=source_frame,
        model_input="analysis-frame-2",
        provenance=(OcrCandidateProvenance.PERIODIC,),
    )

    assert change_candidate is not None
    assert later_periodic is not None
    assert [candidate.index for candidate in store.candidates()] == [0, 2]
    assert not os.path.exists(change_candidate.path)
    assert sum(
        candidate.encoded_bytes for candidate in store.candidates()
    ) <= byte_limit


def test_periodic_candidate_rejects_and_cleans_unsupported_capacity(tmp_path):
    """Periodic coverage that cannot fit makes the Ad Creative unsupported."""
    store = OcrCandidateStore(
        work_dir=str(tmp_path),
        max_bytes=1,
        reserved_periodic_count=1,
    )
    source_frame = np.zeros((100, 200, 3), dtype=np.uint8)

    with pytest.raises(
        OcrCandidateCapacityError,
        match="periodic OCR coverage",
    ):
        store.admit(
            index=0,
            timestamp=0.0,
            source_frame=source_frame,
            model_input="analysis-frame-0",
            provenance=(OcrCandidateProvenance.PERIODIC,),
        )

    assert store.stats.dropped_count == 1
    assert store.stats.dropped_bytes > 1
    assert list(tmp_path.iterdir()) == []
