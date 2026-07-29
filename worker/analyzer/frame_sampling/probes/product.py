from typing import Any

from analyzer.frame_sampling.base import Stage, register_probe
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.deferred import Candidate, DeferredModelProbe


@register_probe(Stage.PRODUCT)
class ProductProbe(DeferredModelProbe):
    """Cost-cascaded product/logo presence: cheap pHash-novelty gate ->
    MobileCLIP similarity -> tag "product-candidate" and track presence intervals.

    The expensive model runs on collected candidates (deferred batch), not
    inline on every frame.
    """

    name = "product"

    def _gate(self, ctx: FrameContext) -> bool:
        return False  # TODO: pHash novelty

    def _candidate(self, ctx: FrameContext) -> Any:
        return None  # TODO: crop / preprocess for MobileCLIP

    def _batch_infer(self, model_inputs: list[Any]) -> list[Any]:
        return []  # TODO: run MobileCLIP once on the batch

    def _emit(self, candidate: Candidate, result: Any) -> None:
        pass  # TODO: on confirm, self._keep(candidate, (self.name,))
