"""Unit tests for ReferenceMatchProbe (and its LogoProbe/ProductProbe subclasses)."""

from unittest.mock import MagicMock

import numpy as np
import pytest
import torch
from PIL import Image

pytestmark = pytest.mark.unit

import analyzer.frame_sampling.probes as probes_pkg  # noqa: F401  (populate registry)
import analyzer.frame_sampling.probes.reference_match as reference_match
from analyzer.frame_sampling.base import ProbeSetup, Stage, get_probe_classes
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.deferred import Candidate
from analyzer.frame_sampling.probes.logo import LogoProbe
from analyzer.frame_sampling.probes.product import ProductProbe
from analyzer.frame_sampling.probes.reference_match import (
    PresenceInterval,
    ReferenceMatchProbe,
    ReferenceMatchResult,
    _ModelInput,
)
from analyzer.types import VideoMetadata


# ---- helpers ----
def _metadata():
    return VideoMetadata(duration_s=1.0, fps=30.0, width=32, height=32, size_bytes=1)


def _setup(work_dir=".", product_image_paths=None, logo_paths=None):
    return ProbeSetup(
        video_metadata=_metadata(),
        work_dir=work_dir,
        product_image_paths=product_image_paths or [],
        logo_paths=logo_paths or [],
    )


class _FakeReferenceProbe(ReferenceMatchProbe):
    """Minimal concrete subclass; reference paths come straight from setup."""

    name = "faketest"

    def _reference_paths(self, setup: ProbeSetup) -> list[str]:
        return setup.product_image_paths


def _fake_mobileclip(embed_dim=2):
    """A fake (model, preprocess) pair with a fixed-shape embedding output."""
    model = MagicMock()
    model.encode_image.return_value = torch.ones(1, embed_dim)

    def preprocess(image):
        return torch.zeros(3, 4, 4)

    return model, preprocess


def _write_tiny_image(path, color=(10, 20, 30)):
    Image.new("RGB", (8, 8), color=color).save(path)


def _solid_frame(value, size=32):
    return np.full((size, size, 3), value, dtype=np.uint8)


def _checkerboard_frame(size=32, block=4):
    frame = np.zeros((size, size, 3), dtype=np.uint8)
    for y in range(0, size, block):
        for x in range(0, size, block):
            if ((x // block) + (y // block)) % 2 == 0:
                frame[y : y + block, x : x + block] = 255
    return frame


def _ctx(index, timestamp, frame):
    gray = frame[:, :, 0]
    return FrameContext(
        index=index,
        timestamp=timestamp,
        frame=frame,
        gray=gray,
        small=frame,
        edges=gray,
    )


# ---- configure(): with reference images ----
def test_configure_builds_clip_embeds_and_orb_descriptors(tmp_path, monkeypatch):
    monkeypatch.setattr(
        reference_match, "get_mobileclip", lambda: _fake_mobileclip(embed_dim=2)
    )

    ref1 = tmp_path / "ref1.jpg"
    ref2 = tmp_path / "ref2.jpg"
    _write_tiny_image(ref1, color=(255, 0, 0))
    _write_tiny_image(ref2, color=(0, 255, 0))

    probe = _FakeReferenceProbe()
    setup = _setup(product_image_paths=[str(ref1), str(ref2)])

    probe.configure(setup)

    assert probe._clip_model is not None
    assert probe._clip_preprocess is not None
    assert probe._ref_clip_embeds is not None
    assert probe._ref_clip_embeds.shape == (2, 2)
    assert probe._ref_labels == ["faketest", "faketest"]
    assert len(probe._ref_orb_descriptors) == 2


# ---- configure(): empty reference list ----
def test_configure_with_empty_references_skips_model_load(monkeypatch):
    load_calls = MagicMock(side_effect=lambda: (_ for _ in ()).throw(
        AssertionError("get_mobileclip should not be called with no references")
    ))
    monkeypatch.setattr(reference_match, "get_mobileclip", load_calls)

    probe = _FakeReferenceProbe()
    setup = _setup(product_image_paths=[])

    probe.configure(setup)

    assert load_calls.call_count == 0
    assert probe._clip_model is None
    assert probe._clip_preprocess is None
    assert probe._ref_clip_embeds is None
    assert probe._ref_orb_descriptors == []


def test_gate_returns_false_when_no_references_configured():
    """Bug-fix regression: configure() must not require model weights when the
    job supplies no reference images, and _gate() must not touch the (unset)
    CLIP preprocessor in that case."""
    probe = _FakeReferenceProbe()
    probe.configure(_setup(product_image_paths=[]))

    assert probe._gate(_ctx(0, 0.0, _solid_frame(0))) is False


# ---- _gate(): phash novelty ----
def test_gate_first_frame_always_true():
    probe = _FakeReferenceProbe()
    probe._clip_preprocess = lambda image: torch.zeros(3, 4, 4)  # pretend configured

    assert probe._gate(_ctx(0, 0.0, _solid_frame(0))) is True


def test_gate_duplicate_frame_is_not_novel():
    probe = _FakeReferenceProbe()
    probe._clip_preprocess = lambda image: torch.zeros(3, 4, 4)

    frame = _solid_frame(50)
    assert probe._gate(_ctx(0, 0.0, frame)) is True
    assert probe._gate(_ctx(1, 1 / 30, frame)) is False


def test_gate_very_different_frame_is_novel():
    probe = _FakeReferenceProbe()
    probe._clip_preprocess = lambda image: torch.zeros(3, 4, 4)

    assert probe._gate(_ctx(0, 0.0, _solid_frame(0))) is True
    # Far enough past the min-spacing window that novelty alone decides it.
    assert probe._gate(_ctx(30, 1.0, _checkerboard_frame())) is True


# ---- _gate(): minimum candidate spacing ----
def test_gate_suppresses_novel_frame_too_close_to_last_kept():
    probe = _FakeReferenceProbe()
    probe._clip_preprocess = lambda image: torch.zeros(3, 4, 4)

    assert probe._gate(_ctx(0, 0.0, _solid_frame(0))) is True
    # Novel content, but well within the min-spacing window -> suppressed.
    assert probe._gate(_ctx(1, 0.1, _checkerboard_frame())) is False


def test_gate_allows_novel_frame_once_spacing_elapses():
    probe = _FakeReferenceProbe()
    probe._clip_preprocess = lambda image: torch.zeros(3, 4, 4)

    assert probe._gate(_ctx(0, 0.0, _solid_frame(0))) is True
    assert probe._gate(_ctx(3, 0.1, _checkerboard_frame())) is False  # too close
    assert probe._gate(_ctx(30, 1.0, _checkerboard_frame())) is True  # spacing OK


# ---- _batch_infer(): ORB / CLIP cascade ----
def test_batch_infer_orb_confirms_without_clip():
    probe = _FakeReferenceProbe()
    probe._orb_match_count = MagicMock(return_value=reference_match._ORB_MATCH_THRESHOLD)
    probe._clip_model = MagicMock()  # should never be called
    probe._ref_clip_embeds = torch.tensor([[1.0, 0.0]])

    model_inputs = [_ModelInput(clip_tensor=torch.zeros(3, 4, 4), gray=np.zeros((4, 4), dtype=np.uint8))]

    results = probe._batch_infer(model_inputs)

    assert results == [True]
    probe._clip_model.encode_image.assert_not_called()


def test_batch_infer_falls_back_to_clip_when_orb_fails():
    probe = _FakeReferenceProbe()
    probe._orb_match_count = MagicMock(return_value=0)
    probe._clip_model = MagicMock()
    probe._clip_model.encode_image.return_value = torch.tensor([[1.0, 0.0]])
    probe._ref_clip_embeds = torch.tensor([[1.0, 0.0]])

    model_inputs = [_ModelInput(clip_tensor=torch.zeros(3, 4, 4), gray=np.zeros((4, 4), dtype=np.uint8))]

    results = probe._batch_infer(model_inputs)

    assert results == [True]  # cosine similarity 1.0 >= threshold


def test_batch_infer_false_when_both_orb_and_clip_fail():
    probe = _FakeReferenceProbe()
    probe._orb_match_count = MagicMock(return_value=0)
    probe._clip_model = MagicMock()
    probe._clip_model.encode_image.return_value = torch.tensor([[0.0, 1.0]])
    probe._ref_clip_embeds = torch.tensor([[1.0, 0.0]])

    model_inputs = [_ModelInput(clip_tensor=torch.zeros(3, 4, 4), gray=np.zeros((4, 4), dtype=np.uint8))]

    results = probe._batch_infer(model_inputs)

    assert results == [False]  # cosine similarity 0.0 < threshold


def test_batch_infer_mixed_batch():
    probe = _FakeReferenceProbe()
    # index 0: ORB confirms; indices 1, 2 fall through to CLIP
    probe._orb_match_count = MagicMock(
        side_effect=[reference_match._ORB_MATCH_THRESHOLD, 0, 0]
    )
    probe._clip_model = MagicMock()
    probe._clip_model.encode_image.return_value = torch.tensor([[1.0, 0.0], [0.0, 1.0]])
    probe._ref_clip_embeds = torch.tensor([[1.0, 0.0]])

    model_inputs = [
        _ModelInput(clip_tensor=torch.zeros(3, 4, 4), gray=np.zeros((4, 4), dtype=np.uint8))
        for _ in range(3)
    ]

    results = probe._batch_infer(model_inputs)

    assert results == [True, True, False]


# ---- _emit() / _result(): presence intervals ----
def _candidate(index):
    return Candidate(index=index, timestamp=index / 30, model_input=None, frame=None)


def test_emit_closes_interval_on_false_after_run_of_true():
    probe = _FakeReferenceProbe()

    probe._emit(_candidate(0), True)
    probe._emit(_candidate(1), True)
    probe._emit(_candidate(2), True)
    probe._emit(_candidate(3), False)

    assert len(probe._intervals) == 1
    interval = probe._intervals[0]
    assert interval.start_index == 0
    assert interval.end_index == 2
    assert interval.start_s == pytest.approx(0.0)
    assert interval.end_s == pytest.approx(2 / 30)
    # state reset after closing
    assert probe._open_start_index is None


def test_result_closes_trailing_open_interval():
    probe = _FakeReferenceProbe()

    probe._emit(_candidate(0), True)
    probe._emit(_candidate(1), True)

    result = probe._result()

    assert isinstance(result, ReferenceMatchResult)
    assert result.presence_intervals == [
        PresenceInterval(start_index=0, start_s=0.0, end_index=1, end_s=pytest.approx(1 / 30))
    ]
    assert probe._open_start_index is None


def test_result_with_no_confirmed_frames_is_empty():
    probe = _FakeReferenceProbe()
    result = probe._result()
    assert result.presence_intervals == []


# ---- reference-path wiring ----
def test_logo_probe_reads_logo_paths_from_setup():
    setup = _setup(logo_paths=["a", "b"])
    assert LogoProbe()._reference_paths(setup) == ["a", "b"]


def test_product_probe_reads_product_image_paths_from_setup():
    setup = _setup(product_image_paths=["x", "y"])
    assert ProductProbe()._reference_paths(setup) == ["x", "y"]


# ---- registry ordering ----
def test_logo_and_product_probes_registered_at_expected_stages():
    classes = get_probe_classes()
    assert classes.index(ProductProbe) < classes.index(LogoProbe)
    assert Stage.PRODUCT < Stage.LOGO
