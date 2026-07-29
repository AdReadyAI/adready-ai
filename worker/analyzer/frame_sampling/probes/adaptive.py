from dataclasses import dataclass

from analyzer.frame_sampling.base import Probe, ProbeResult, ProbeSetup, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext


@dataclass
class AdaptiveSamplerResult(ProbeResult):
    keyframe_count: int = 0
    keyframe_indices: tuple[int, ...] = ()


@register_probe(Stage.SAMPLE)
class AdaptiveSampler(Probe):
    """Selects keyframes from the per-frame change signal."""

    name = "adaptive"

    def __init__(self) -> None:
        self._budget = 0.0
        self._keyframe_indices: list[int] = []
        self._last_keep_index: int | None = None
        self._threshold = None
        self._min_gap = None
        self._max_gap = None

    def configure(self, setup: ProbeSetup) -> None:
        from config.settings import (
            ADAPTIVE_KEYFRAME_THRESHOLD,
            ADAPTIVE_MIN_GAP_S,
            ADAPTIVE_MAX_GAP_S,
        )

        fps = setup.video_metadata.fps or 0.0
        self._threshold = ADAPTIVE_KEYFRAME_THRESHOLD
        self._min_gap = max(1, round(ADAPTIVE_MIN_GAP_S * fps))
        self._max_gap = max(self._min_gap + 1, round(ADAPTIVE_MAX_GAP_S * fps))

    def process(self, ctx: FrameContext) -> None:
        if self._last_keep_index is None:
            self._keep_keyframe(ctx)
            return

        gap = ctx.index - self._last_keep_index

        if ctx.shot_boundary:
            self._keep_keyframe(ctx)
            return

        self._budget += ctx.content_val

        if gap >= self._max_gap:
            self._keep_keyframe(ctx)
            return

        if self._budget >= self._threshold and gap >= self._min_gap:
            self._keep_keyframe(ctx)

    def finalize(self) -> AdaptiveSamplerResult:
        return AdaptiveSamplerResult(
            keyframe_count=len(self._keyframe_indices),
            keyframe_indices=tuple(self._keyframe_indices),
        )

    def _keep_keyframe(self, ctx: FrameContext) -> None:
        ctx.keep(("keyframe",))
        self._keyframe_indices.append(ctx.index)
        self._budget = 0.0
        self._last_keep_index = ctx.index
