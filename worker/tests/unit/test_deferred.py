"""Unit tests for the deferred model-batch pattern (DeferredModelProbe)."""

import os

import numpy as np
import pytest

pytestmark = pytest.mark.unit

from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.deferred import Candidate, DeferredModelProbe
from analyzer.frame_sampling.store import FrameStore


# ---- helpers ----
def _frame(height=10, width=10):
    return np.zeros((height, width, 3), dtype=np.uint8)


def _ctx(index, timestamp, frame, store=None):
    return FrameContext(
        index=index,
        timestamp=timestamp,
        frame=frame,
        gray=frame[:, :, 0],
        small=frame,
        edges=frame[:, :, 0],
        store=store,
    )


def _make_probe(gate_fn, infer_fn, calls, batch_size=2):
    class _FakeModelProbe(DeferredModelProbe):
        name = "fake"
        _BATCH_SIZE = batch_size

        def _gate(self, ctx):
            return gate_fn(ctx)

        def _candidate(self, ctx):
            return ctx.index  # lightweight input, not full-res

        def _batch_infer(self, model_inputs):
            calls.append(len(model_inputs))
            return infer_fn(model_inputs)

        def _emit(self, candidate: Candidate, result):
            if result:
                self._keep(candidate, (self.name,))

    return _FakeModelProbe()


def _drive(probe, count, store=None):
    frame = _frame()
    for i in range(count):
        probe.process(_ctx(i, i * 0.1, frame, store=store))


# ---- gate collects, model never runs in the loop ----
def test_gate_false_collects_nothing_and_never_infers():
    calls = []
    probe = _make_probe(lambda ctx: False, lambda xs: [], calls)

    _drive(probe, 5)
    result = probe.finalize()

    assert probe._candidates == []
    assert calls == []  # _batch_infer never called
    assert isinstance(result, type(probe.finalize()))


def test_no_inference_during_process():
    calls = []
    probe = _make_probe(lambda ctx: True, lambda xs: [False] * len(xs), calls)

    _drive(probe, 5)

    assert len(probe._candidates) == 5
    assert calls == []  # nothing inferred yet — only gates ran


def test_candidate_inputs_are_lightweight_not_full_res():
    calls = []
    probe = _make_probe(lambda ctx: True, lambda xs: [False] * len(xs), calls)

    _drive(probe, 3)

    assert [c.model_input for c in probe._candidates] == [0, 1, 2]
    assert all(isinstance(c.model_input, int) for c in probe._candidates)


# ---- inference only in finalize(), batched ----
def test_batch_infer_runs_only_in_finalize_and_is_chunked():
    calls = []
    probe = _make_probe(
        lambda ctx: True, lambda xs: [False] * len(xs), calls, batch_size=2
    )

    _drive(probe, 5)
    assert calls == []  # still nothing before finalize

    probe.finalize()
    assert calls == [2, 2, 1]  # ceil(5/2) batches of the declared size


# ---- gate bounds the candidate buffer ----
def test_candidates_bounded_by_gate():
    calls = []
    probe = _make_probe(
        lambda ctx: ctx.index % 2 == 0, lambda xs: [False] * len(xs), calls
    )

    _drive(probe, 5)

    assert [c.index for c in probe._candidates] == [0, 2, 4]


# ---- emit keeps confirmed via the store ----
def test_emit_keeps_confirmed_and_drops_rejects(tmp_path):
    store = FrameStore(str(tmp_path))
    calls = []
    # confirm only index 0
    probe = _make_probe(lambda ctx: True, lambda xs: [x == 0 for x in xs], calls)

    _drive(probe, 4, store=store)
    probe.finalize()

    manifest = store.manifest()
    assert len(manifest) == 1
    assert manifest[0].tags == ("fake",)
    assert os.path.exists(manifest[0].path)


# ---- default _result ----
def test_result_defaults_to_probe_result():
    from analyzer.frame_sampling.base import ProbeResult

    calls = []
    probe = _make_probe(lambda ctx: False, lambda xs: [], calls)

    assert isinstance(probe.finalize(), ProbeResult)
