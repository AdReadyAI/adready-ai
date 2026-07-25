from analyzer.frame_sampling.base import Probe, ProbeResult, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext


@register_probe(Stage.QUALITY)
class QualityProbe(Probe):
    """Layer-A deterministic CV metrics (sharpness, exposure, contrast,
    colorfulness, noise, temporal stability) plus flagged-frame collection.
    """

    name = "quality"

    def process(self, ctx: FrameContext) -> None:
        pass  # TODO: Layer-A metrics (deferred)

    def finalize(self) -> ProbeResult:
        return ProbeResult()
