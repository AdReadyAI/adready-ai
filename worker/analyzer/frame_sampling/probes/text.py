from typing import Any

from analyzer.frame_sampling.base import Stage, register_probe
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.deferred import Candidate, DeferredModelProbe


@register_probe(Stage.TEXT)
class TextProbe(DeferredModelProbe):
    """Cost-cascaded text detection: cheap edge-density gate -> EAST ->
    text-hash change -> tag "text" and open/close a text time segment.

    The expensive model runs on collected candidates (deferred batch), not
    inline on every frame.
    """

    name = "text"

    def _gate(self, ctx: FrameContext) -> bool:
        return False  # TODO: edge-density spike

    def _candidate(self, ctx: FrameContext) -> Any:
        return None  # TODO: crop / preprocess for EAST

    def _batch_infer(self, model_inputs: list[Any]) -> list[Any]:
        return []  # TODO: run EAST once on the batch

    def _emit(self, candidate: Candidate, result: Any) -> None:
        pass  # TODO: on confirm, self._keep(candidate, (self.name,))
