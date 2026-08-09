"""Unit tests for the frame-sampling decode pass and probe registry."""

import os
from dataclasses import fields
from unittest.mock import MagicMock

import numpy as np
import pytest

pytestmark = pytest.mark.unit

import analyzer.frame_sampling.probes  # noqa: F401  (populate the probe registry)
from analyzer.frame_sampling.base import (
    FrameSelection,
    Probe,
    ProbeResult,
    ProbeSetup,
    Stage,
    get_probe_classes,
    register_probe,
)
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.probes.adaptive import (
    AdaptiveSampler,
    AdaptiveSamplerResult,
)
from analyzer.frame_sampling.probes.quality import QualityProbe, QualityProbeResult
from analyzer.text_detection.east import (
    EastTextRegionDetector,
    EastUnavailableError,
)
from analyzer.frame_sampling.probes.text import TextProbe
from analyzer.frame_sampling.sampler import FrameSampler
from analyzer.frame_sampling.store import FrameStore
from analyzer.types import VideoMetadata
from app.errors import UnrecoverableError


# ---- helpers ----
def _metadata(fps=30.0, width=200, height=100):
    return VideoMetadata(
        duration_s=1.0, fps=fps, width=width, height=height, size_bytes=1000
    )


def _sampler(tmp_path, metadata=None):
    return FrameSampler("video.mp4", metadata or _metadata(), str(tmp_path))


def _frame(height=100, width=200):
    return np.random.randint(0, 255, (height, width, 3), dtype=np.uint8)


def _ctx(index, timestamp, frame):
    return FrameContext(
        index=index,
        timestamp=timestamp,
        frame=frame,
        gray=frame[:, :, 0],
        small=frame,
        edges=frame[:, :, 0],
    )


# ---- registry / contract ----
def test_registered_probes_in_stage_order():
    names = [cls.__name__ for cls in get_probe_classes()]
    assert names == [
        "SceneProbe",
        "AdaptiveSampler",
        "QualityProbe",
        "TextProbe",
        "ProductProbe",
        "LogoProbe",
    ]


def test_stage_is_strictly_ordered():
    assert (
        Stage.SCENE
        < Stage.SAMPLE
        < Stage.QUALITY
        < Stage.TEXT
        < Stage.PRODUCT
        < Stage.LOGO
    )


def test_register_probe_sorts_by_stage(monkeypatch):
    import analyzer.frame_sampling.base as base

    monkeypatch.setattr(base, "_PROBE_REGISTRY", [])

    @base.register_probe(Stage.PRODUCT)
    class Late(Probe):
        def process(self, ctx):  # noqa: D401
            ...

        def finalize(self):
            return ProbeResult()

    @base.register_probe(Stage.SCENE)
    class Early(Probe):
        def process(self, ctx):
            ...

        def finalize(self):
            return ProbeResult()

    assert base.get_probe_classes() == [Early, Late]


def test_probe_result_is_subclassable_carrier():
    from dataclasses import dataclass, field

    @dataclass
    class WithExtras(ProbeResult):
        cuts: list = field(default_factory=list)

    assert WithExtras(cuts=[1.0]).cuts == [1.0]


# ---- AdaptiveSampler ----
def _adaptive(fps=30.0):
    """Construct and configure an AdaptiveSampler (configure() is required)."""
    sampler = AdaptiveSampler()
    setup = MagicMock()
    setup.video_metadata.fps = fps
    sampler.configure(setup)
    return sampler


def test_adaptive_sampler_seeds_first_frame(tmp_path):
    store = FrameStore(str(tmp_path))
    sampler = _adaptive()

    for index in range(3):
        ctx = _ctx(index, index / 30, _frame())
        ctx.store = store
        sampler.process(ctx)

    result = sampler.finalize()

    # Even with no change signal, the opening frame is always kept.
    assert [frame.timestamp for frame in store.manifest()] == [pytest.approx(0.0)]
    assert result == AdaptiveSamplerResult(keyframe_count=1, keyframe_indices=(0,))


def test_adaptive_sampler_keeps_shot_starts_and_resets_budget(tmp_path):
    store = FrameStore(str(tmp_path))
    sampler = _adaptive()
    frames = [
        (0, 0.3, False),
        (1, 0.3, True),
        (2, 0.3, False),
    ]

    for index, content_val, shot_boundary in frames:
        ctx = _ctx(index, index / 30, _frame())
        ctx.store = store
        ctx.content_val = content_val
        ctx.shot_boundary = shot_boundary
        sampler.process(ctx)

    result = sampler.finalize()

    # Seed (0) plus the shot boundary (1); budget at frame 2 hasn't crossed.
    assert [frame.timestamp for frame in store.manifest()] == [
        pytest.approx(0.0),
        pytest.approx(1 / 30),
    ]
    assert result.keyframe_indices == (0, 1)


def test_adaptive_sampler_keeps_when_change_budget_reaches_threshold(tmp_path):
    store = FrameStore(str(tmp_path))
    sampler = _adaptive()
    sampler._min_gap = 1  # isolate the change-budget trigger from the cooldown

    for index, content_val in enumerate([0.2, 0.2, 0.1, 0.4, 0.1]):
        ctx = _ctx(index, index / 30, _frame())
        ctx.store = store
        ctx.content_val = content_val
        sampler.process(ctx)

    result = sampler.finalize()
    manifest = store.manifest()

    # Seed (0), then the budget crosses 0.5 at frame 3 (0.2+0.2+0.1+0.4).
    assert [frame.timestamp for frame in manifest] == [
        pytest.approx(0.0),
        pytest.approx(3 / 30),
    ]
    assert all(frame.tags == ("keyframe",) for frame in manifest)
    assert result.keyframe_count == 2


def test_adaptive_sampler_min_gap_suppresses_bursts(tmp_path):
    store = FrameStore(str(tmp_path))
    sampler = _adaptive()
    sampler._min_gap = 3  # cooldown: no keyframes closer than 3 frames apart

    for index in range(7):
        ctx = _ctx(index, index / 30, _frame())
        ctx.store = store
        ctx.content_val = 1.0  # over threshold every frame
        sampler.process(ctx)

    result = sampler.finalize()

    # Without the cooldown this would keep every frame; instead it spaces by 3.
    assert result.keyframe_indices == (0, 3, 6)


def test_adaptive_sampler_max_gap_forces_keyframe_on_static(tmp_path):
    store = FrameStore(str(tmp_path))
    sampler = _adaptive()
    sampler._max_gap = 4  # ceiling: force a keyframe at least every 4 frames

    for index in range(9):
        ctx = _ctx(index, index / 30, _frame())
        ctx.store = store
        ctx.content_val = 0.0  # fully static: budget never grows
        sampler.process(ctx)

    result = sampler.finalize()

    # Seed (0), then forced every 4 frames despite zero change.
    assert result.keyframe_indices == (0, 4, 8)


def test_adaptive_sampler_configure_derives_gaps_from_fps():
    sampler = AdaptiveSampler()
    setup = MagicMock()

    setup.video_metadata.fps = 30.0
    sampler.configure(setup)
    assert sampler._min_gap == 6    # round(0.2 s * 30 fps)
    assert sampler._max_gap == 60   # round(2.0 s * 30 fps)

    setup.video_metadata.fps = 60.0
    sampler.configure(setup)
    assert sampler._min_gap == 12   # gaps scale with fps -> constant real-time spacing
    assert sampler._max_gap == 120


def test_frame_selection_holds_no_pixels():
    assert {f.name for f in fields(FrameSelection)} == {"index", "timestamp", "tags"}


# ---- _downscale ----
def test_downscale_landscape_caps_long_side(tmp_path):
    out = _sampler(tmp_path)._downscale(_frame(height=1080, width=1920))
    assert max(out.shape[:2]) == 384
    assert out.shape[1] == 384  # width is the long side


def test_downscale_portrait_caps_long_side(tmp_path):
    out = _sampler(tmp_path)._downscale(_frame(height=1920, width=1080))
    assert max(out.shape[:2]) == 384
    assert out.shape[0] == 384  # height is the long side


def test_downscale_small_frame_unchanged(tmp_path):
    frame = _frame(height=100, width=200)
    out = _sampler(tmp_path)._downscale(frame)
    assert out is frame


# ---- _build_context ----
def test_build_context_features(tmp_path):
    sampler = _sampler(tmp_path, _metadata(fps=30.0))
    frame = _frame(height=100, width=200)

    ctx = sampler._build_context(30, frame)

    assert ctx.index == 30
    assert ctx.timestamp == pytest.approx(1.0)
    assert ctx.frame is frame
    assert ctx.gray.ndim == 2
    assert ctx.small.shape[2] == 3
    assert max(ctx.small.shape[:2]) <= 384
    assert ctx.edges.shape == ctx.small.shape[:2]


# ---- _decode ----
def test_decode_yields_contexts_and_releases(tmp_path, monkeypatch):
    frames = [_frame() for _ in range(3)]
    cap = MagicMock()
    cap.isOpened.return_value = True
    cap.read.side_effect = [(True, f) for f in frames] + [(False, None)]
    monkeypatch.setattr(
        "analyzer.frame_sampling.sampler.cv2.VideoCapture", lambda path: cap
    )

    contexts = list(_sampler(tmp_path)._decode())

    assert [c.index for c in contexts] == [0, 1, 2]
    cap.release.assert_called_once()


def test_decode_raises_when_open_fails(tmp_path, monkeypatch):
    cap = MagicMock()
    cap.isOpened.return_value = False
    monkeypatch.setattr(
        "analyzer.frame_sampling.sampler.cv2.VideoCapture", lambda path: cap
    )

    with pytest.raises(UnrecoverableError):
        list(_sampler(tmp_path)._decode())


# ---- FrameStore (write-at-selection) ----
def test_store_keeps_once_and_unions_tags(tmp_path):
    store = FrameStore(str(tmp_path))
    ctx = _ctx(5, 0.5, _frame())

    store.keep(ctx, ("keyframe",))
    store.keep(ctx, ("text",))
    manifest = store.manifest()

    assert len(manifest) == 1
    assert manifest[0].tags == ("keyframe", "text")
    assert manifest[0].timestamp == 0.5
    assert os.path.exists(manifest[0].path)


def test_store_manifest_ordered_by_index(tmp_path):
    store = FrameStore(str(tmp_path))
    store.keep(_ctx(2, 0.2, _frame()), ("keyframe",))
    store.keep(_ctx(0, 0.0, _frame()), ("keyframe",))

    assert [f.timestamp for f in store.manifest()] == [0.0, 0.2]


def test_store_empty_manifest(tmp_path):
    assert FrameStore(str(tmp_path)).manifest() == []


# ---- run (end-to-end) ----
def test_run_produces_manifest_from_keeping_probe(tmp_path, monkeypatch):
    sampler = _sampler(tmp_path)
    frame = _frame()
    contexts = [sampler._build_context(i, frame) for i in range(3)]
    monkeypatch.setattr(sampler, "_decode", lambda: iter(contexts))

    class KeepingProbe(Probe):
        name = "keep"

        def process(self, ctx):
            ctx.keep(("keyframe",))

        def finalize(self):
            return ProbeResult()

    sampler.probes = [KeepingProbe()]

    manifest = sampler.run()

    assert len(manifest) == 3
    assert all("keyframe" in f.tags for f in manifest)


# ---- probe stubs contract ----
# Probes with a real implementation, covered by their own tests.
_IMPLEMENTED_PROBES = {"scene", "adaptive", "quality"}


def test_probe_stubs_are_noop(tmp_path):
    ctx = _sampler(tmp_path)._build_context(0, _frame())
    for cls in get_probe_classes():
        if cls.name in _IMPLEMENTED_PROBES:
            continue
        probe = cls()
        assert probe.process(ctx) is None
        result = probe.finalize()
        assert isinstance(result, ProbeResult)


# ---- probe configure / ProbeSetup ----
class _MinimalProbe(Probe):
    name = "minimal"

    def process(self, ctx):
        ...

    def finalize(self):
        return ProbeResult()


def test_probe_configure_default_is_noop():
    setup = ProbeSetup(video_metadata=_metadata(), work_dir="/tmp")
    assert _MinimalProbe().configure(setup) is None


def test_probe_setup_image_paths_default_empty():
    setup = ProbeSetup(video_metadata=_metadata(), work_dir="/tmp")
    assert setup.product_image_paths == []
    assert setup.logo_paths == []


def test_sampler_configures_probes_with_job_inputs(tmp_path, monkeypatch):
    import analyzer.frame_sampling.base as base

    class CapturingProbe(Probe):
        name = "cap"

        def configure(self, setup):
            self.setup = setup

        def process(self, ctx):
            ...

        def finalize(self):
            return ProbeResult()

    monkeypatch.setattr(base, "_PROBE_REGISTRY", [(Stage.SCENE, CapturingProbe)])

    sampler = FrameSampler(
        "v.mp4",
        _metadata(),
        str(tmp_path),
        product_image_paths=["prod"],
        logo_paths=["logo"],
    )
    probe = sampler.probes[0]
    assert probe.setup.video_metadata is sampler.metadata
    assert probe.setup.work_dir == str(tmp_path)
    assert probe.setup.product_image_paths == ["prod"]
    assert probe.setup.logo_paths == ["logo"]


# ---- name-collision guard ----
def test_validate_probe_names_rejects_duplicates():
    class Dup(Probe):
        name = "dup"

        def process(self, ctx):
            ...

        def finalize(self):
            return ProbeResult()

    with pytest.raises(ValueError):
        FrameSampler._validate_probe_names([Dup(), Dup()])


def test_validate_probe_names_rejects_empty():
    class Empty(Probe):
        name = ""

        def process(self, ctx):
            ...

        def finalize(self):
            return ProbeResult()

    with pytest.raises(ValueError):
        FrameSampler._validate_probe_names([Empty()])


# ---- failure isolation ----
class _BadProcess(Probe):
    name = "bad"

    def process(self, ctx):
        raise RuntimeError("boom")

    def finalize(self):
        return ProbeResult()


class _GoodKeeper(Probe):
    name = "good"

    def process(self, ctx):
        ctx.keep(("keyframe",))

    def finalize(self):
        return ProbeResult()


def test_runtime_text_probe_uses_east_adapter(tmp_path):
    """Only the registered runtime TextProbe receives the real EAST adapter."""
    sampler = _sampler(tmp_path)

    text_probe = next(
        probe for probe in sampler.probes if isinstance(probe, TextProbe)
    )

    assert isinstance(text_probe._detector, EastTextRegionDetector)


def test_unavailable_east_does_not_disable_unrelated_probe(
    tmp_path,
    monkeypatch,
):
    """An OCR-local model failure leaves other sampler analyses operational."""
    import analyzer.text_detection.east as east

    sampler = _sampler(tmp_path)
    text_probe = next(
        probe for probe in sampler.probes if isinstance(probe, TextProbe)
    )
    frame = _frame()
    context = sampler._build_context(0, frame)
    monkeypatch.setattr(sampler, "_decode", lambda: iter([context]))

    def unavailable_model():
        """Represent the packaged EAST graph being absent at inference time."""
        raise EastUnavailableError("EAST graph is unavailable")

    monkeypatch.setattr(east, "load_east_network", unavailable_model)
    sampler.probes = [text_probe, _GoodKeeper()]

    manifest = sampler.run()

    assert isinstance(sampler.probe_errors["text"], EastUnavailableError)
    assert "text" not in sampler.probe_results
    assert "good" in sampler.probe_results
    assert len(manifest) == 1


def test_run_isolates_failing_process(tmp_path, monkeypatch):
    sampler = _sampler(tmp_path)
    frame = _frame()
    contexts = [sampler._build_context(i, frame) for i in range(3)]
    monkeypatch.setattr(sampler, "_decode", lambda: iter(contexts))
    sampler.probes = [_BadProcess(), _GoodKeeper()]

    manifest = sampler.run()

    assert isinstance(sampler.probe_errors["bad"], RuntimeError)
    assert "bad" not in sampler.probe_results
    assert "good" in sampler.probe_results
    assert len(manifest) == 3


def test_run_disables_probe_after_first_error(tmp_path, monkeypatch):
    sampler = _sampler(tmp_path)
    frame = _frame()
    contexts = [sampler._build_context(i, frame) for i in range(3)]
    monkeypatch.setattr(sampler, "_decode", lambda: iter(contexts))

    class Counting(Probe):
        name = "count"

        def __init__(self):
            self.calls = 0

        def process(self, ctx):
            self.calls += 1
            raise RuntimeError("boom")

        def finalize(self):
            return ProbeResult()

    probe = Counting()
    sampler.probes = [probe]

    sampler.run()

    assert probe.calls == 1  # disabled after the first error
    assert "count" in sampler.probe_errors


def test_run_isolates_failing_finalize(tmp_path, monkeypatch):
    sampler = _sampler(tmp_path)
    frame = _frame()
    contexts = [sampler._build_context(i, frame) for i in range(2)]
    monkeypatch.setattr(sampler, "_decode", lambda: iter(contexts))

    class BadFinalize(Probe):
        name = "badf"

        def process(self, ctx):
            ...

        def finalize(self):
            raise RuntimeError("boom")

    sampler.probes = [BadFinalize(), _GoodKeeper()]

    manifest = sampler.run()

    assert isinstance(sampler.probe_errors["badf"], RuntimeError)
    assert "good" in sampler.probe_results
    assert len(manifest) == 2


# ---- shared type: shot_boundary ----
def test_frame_context_shot_boundary_default(tmp_path):
    ctx = _sampler(tmp_path)._build_context(0, _frame())
    assert ctx.shot_boundary is False


# ---- QualityProbe ----
def _quality_ctx(index, gray, shot_boundary=False, store=None):
    """A single-channel synthetic frame, like _ctx() but with a controlled
    grayscale pattern instead of _frame()'s random noise.
    """
    ctx = FrameContext(
        index=index,
        timestamp=index / 30,
        frame=np.stack([gray, gray, gray], axis=-1),
        gray=gray,
        small=gray,
        edges=gray,
        shot_boundary=shot_boundary,
    )
    ctx.store = store
    return ctx


def _solid(value, height=20, width=20):
    return np.full((height, width), value, dtype=np.uint8)


def _edge(low, high, height=20, width=20):
    """A single clean vertical edge — sharp and high-contrast without the
    per-pixel alternation that (realistically) also trips the noise/grain
    heuristic, the same way real fine texture can.
    """
    gray = np.full((height, width), low, dtype=np.uint8)
    gray[:, width // 2 :] = high
    return gray


def test_quality_probe_flags_flat_frame_as_blur_and_low_contrast(tmp_path):
    store = FrameStore(str(tmp_path))
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _solid(128), store=store))

    assert probe._flags[0].reasons == ("blur", "contrast")
    # FrameStore holds tags in a set and sorts them on manifest() — alphabetical,
    # not insertion order.
    assert store.manifest()[0].tags == ("blur", "contrast", "quality")


def test_quality_probe_does_not_flag_sharp_high_contrast_frame(tmp_path):
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _edge(100, 160)))

    assert probe._flags == []


def test_quality_probe_flags_near_black_frame_as_exposure(tmp_path):
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _solid(0)))

    assert "exposure" in probe._flags[0].reasons
    assert probe._flags[0].scores["mean_luma"] == pytest.approx(0.0)


def test_quality_probe_temporal_spike_lands_on_dark_frame_is_cut_to_black(tmp_path):
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _solid(200)))
    probe.process(_quality_ctx(1, _solid(0)))

    assert "cut_to_black" in probe._flags[-1].reasons


def test_quality_probe_temporal_spike_with_shot_boundary_is_cut(tmp_path):
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _solid(50)))
    probe.process(_quality_ctx(1, _solid(200), shot_boundary=True))

    assert "cut" in probe._flags[-1].reasons


def test_quality_probe_temporal_spike_without_shot_boundary_is_flicker(tmp_path):
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _solid(50)))
    probe.process(_quality_ctx(1, _solid(200), shot_boundary=False))

    assert "flicker" in probe._flags[-1].reasons


def test_quality_probe_flags_freeze_after_sustained_static_run(tmp_path):
    from config.settings import QUALITY_FREEZE_MIN_FRAMES

    probe = QualityProbe()
    for index in range(QUALITY_FREEZE_MIN_FRAMES + 2):
        probe.process(_quality_ctx(index, _solid(128)))

    freeze_hits = [f for f in probe._flags if "freeze" in f.reasons]
    # Flagged once, on the frame where the sustained run first crosses the
    # threshold — not on every frame after, which would flood the manifest.
    # The first frame has no predecessor (no delta at all), so it takes
    # QUALITY_FREEZE_MIN_FRAMES + 1 frames to accumulate that many
    # low-delta transitions.
    assert len(freeze_hits) == 1
    assert freeze_hits[0].index == QUALITY_FREEZE_MIN_FRAMES


def test_quality_probe_finalize_returns_accumulated_flags(tmp_path):
    probe = QualityProbe()
    probe.process(_quality_ctx(0, _solid(128)))

    result = probe.finalize()

    assert isinstance(result, QualityProbeResult)
    assert len(result.flags) == 1


def test_quality_probe_unflagged_frame_is_not_kept(tmp_path):
    store = FrameStore(str(tmp_path))
    probe = QualityProbe()

    probe.process(_quality_ctx(0, _edge(100, 160), store=store))

    assert store.manifest() == []


# ---- store.keep_frame ----
def test_store_keep_frame_writes_once_and_unions(tmp_path):
    store = FrameStore(str(tmp_path))
    frame = _frame()
    store.keep_frame(3, 0.3, frame, ("keyframe",))
    store.keep_frame(3, 0.3, frame, ("product",))

    manifest = store.manifest()
    assert len(manifest) == 1
    assert manifest[0].tags == ("keyframe", "product")
    assert os.path.exists(manifest[0].path)
