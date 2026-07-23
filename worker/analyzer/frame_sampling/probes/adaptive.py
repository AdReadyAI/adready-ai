from dataclasses import dataclass

from analyzer.frame_sampling.base import Probe, ProbeResult, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext


_DEFAULT_THRESHOLD = 0.5


@dataclass
class AdaptiveSamplerResult(ProbeResult):
    keyframe_count: int
    keyframe_indices: tuple[int, ...]


@register_probe(Stage.SAMPLE)
class AdaptiveSampler(Probe):
    """Selects keyframes from the change signal (adaptive change score).

    Reads `content_val` (set by SceneProbe) to decide whether the current frame
    is a keyframe candidate for the storyline / visual-description track.
    """

    name = "adaptive"

    def __init__(self) -> None:
        self._budget = 0.0
        self._keyframe_indices: list[int] = []
        self._threshold = self._configured_threshold()

    def _configured_threshold(self) -> float:
        try:
            from config.settings import ADAPTIVE_KEYFRAME_THRESHOLD
        except KeyError:
            return _DEFAULT_THRESHOLD
        return ADAPTIVE_KEYFRAME_THRESHOLD

    def _keep_keyframe(self, ctx: FrameContext) -> None:
        ctx.keep(("keyframe",))
        self._keyframe_indices.append(ctx.index)

    def process(self, ctx: FrameContext) -> None:
        if ctx.shot_boundary:
            self._keep_keyframe(ctx)
            self._budget = 0.0
            return

        self._budget += ctx.content_val
        if self._budget >= self._threshold:
            self._keep_keyframe(ctx)
            self._budget = 0.0

    def finalize(self) -> ProbeResult:
        return AdaptiveSamplerResult(
            keyframe_count=len(self._keyframe_indices),
            keyframe_indices=tuple(self._keyframe_indices),
        )
