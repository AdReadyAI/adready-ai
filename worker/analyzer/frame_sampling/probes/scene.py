from analyzer.frame_sampling.base import Probe, ProbeResult, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext


@register_probe(Stage.SCENE)
class SceneProbe(Probe):
    """Computes a per-frame content-change value and detects shot cuts.

    Writes `content_val` onto the FrameContext so AdaptiveSampler can reuse it.
    Runs before AdaptiveSampler in the probe order.
    """

    name = "scene"

    def process(self, ctx: FrameContext) -> None:
        pass  # TODO: content_val + shot-cut detection

    def finalize(self) -> ProbeResult:
        return ProbeResult()
