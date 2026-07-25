"""Deferred model-batch pattern for gate probes.

Model-backed probes never run their model inside the decode loop. During the
loop they run a cheap gate and collect candidates; the model runs once, batched,
in finalize(). This keeps per-frame cost low and inference throughput high.
"""

from abc import abstractmethod
from dataclasses import dataclass
from typing import Any

from analyzer.frame_sampling.base import Probe, ProbeResult
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.store import FrameStore


@dataclass
class Candidate:
    """A gated frame awaiting batched inference.

    Retention is bounded by the gate (a small subset), never by video length,
    and lives only until finalize(). `model_input` is the lightweight,
    preprocessed input; `frame` is the full-res pixels kept only so a confirmed
    frame can be saved.
    """

    index: int
    timestamp: float
    model_input: Any
    frame: Any


class DeferredModelProbe(Probe):
    """Cost-cascade base: cheap gate in the loop, batched model in finalize().

    Subclasses implement four hooks; the collect -> batch -> emit skeleton and
    the memory discipline live here. No model runs in process().
    """

    _BATCH_SIZE = 16

    def __init__(self) -> None:
        self._candidates: list[Candidate] = []
        self._store: FrameStore | None = None


    def process(self, ctx: FrameContext) -> None:
        self._store = ctx.store
        if self._gate(ctx):
            self._candidates.append(
                Candidate(
                    index=ctx.index,
                    timestamp=ctx.timestamp,
                    model_input=self._candidate(ctx),
                    frame=ctx.frame,
                )
            )

    def finalize(self) -> ProbeResult:
        for start in range(0, len(self._candidates), self._BATCH_SIZE):
            batch = self._candidates[start : start + self._BATCH_SIZE]
            results = self._batch_infer([c.model_input for c in batch])
            for candidate, result in zip(batch, results):
                self._emit(candidate, result)
        return self._result()

    def _keep(self, candidate: Candidate, tags: tuple[str, ...]) -> None:
        if self._store is not None:
            self._store.keep_frame(
                candidate.index, candidate.timestamp, candidate.frame, tags
            )

    @abstractmethod
    def _gate(self, ctx: FrameContext) -> bool:
        """Cheap per-frame check (no model). True = collect as a candidate."""
        ...

    @abstractmethod
    def _candidate(self, ctx: FrameContext) -> Any:
        """Build the lightweight, model-ready input for a gated frame."""
        ...

    @abstractmethod
    def _batch_infer(self, model_inputs: list[Any]) -> list[Any]:
        """Run the model once on a batch of model inputs; one result each."""
        ...

    @abstractmethod
    def _emit(self, candidate: Candidate, result: Any) -> None:
        """Handle one inference result: keep confirmed frames, drop rejects."""
        ...

    def _result(self) -> ProbeResult:
        """Return the probe's ProbeResult (override to attach extras)."""
        return ProbeResult()
