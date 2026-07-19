from analyzer.frame_sampling.base import Probe, ProbeResult, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext


@register_probe(Stage.SAMPLE)
class AdaptiveSampler(Probe):
    """Selects keyframes from the change signal (adaptive change score).

    Reads `content_val` (set by SceneProbe) to decide whether the current frame
    is a keyframe candidate for the storyline / visual-description track.
    """

    name = "adaptive"

    def process(self, ctx: FrameContext) -> None:
        pass  # TODO: keyframe selection from content_val

    def finalize(self) -> ProbeResult:
        return ProbeResult()
