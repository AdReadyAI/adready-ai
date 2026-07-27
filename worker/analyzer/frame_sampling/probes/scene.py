from dataclasses import dataclass, field
from scenedetect import StatsManager, ContentDetector, ThresholdDetector, FrameTimecode

from analyzer.frame_sampling.base import Probe, ProbeResult, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext
from config.settings import (
    SCENE_CUT_THRESHOLD, 
    SCENE_CONTENT_SCALE, 
    SCENE_MIN_SHOT_FRAMES
)

@dataclass
class Shot:
    start_s: float
    end_s: float
    start_index: int
    end_index: int

@dataclass
class SceneProbeResult(ProbeResult):
    shots: list[Shot] = field(default_factory=list)
    pacing: dict = field(default_factory=dict)
    fades: list[float] = field(default_factory=list)

@register_probe(Stage.SCENE)
class SceneProbe(Probe):
    """Computes a per-frame content-change value and detects shot cuts."""

    name = "scene"
    KEYS = ["content_val"]

    def configure(self, setup) -> None:
        self.fps = setup.video_metadata.fps
        self.stats = StatsManager()
        self.content = ContentDetector(
            threshold=SCENE_CUT_THRESHOLD, min_scene_len=SCENE_MIN_SHOT_FRAMES
        )
        self.threshold = ThresholdDetector()
        self.detectors = [self.content, self.threshold]
        for d in self.detectors:
            d.stats_manager = self.stats

        self.cut_set: set[int] = set()
        self.fade_frames: list[int] = []
        self.last_index = 0


    def process(self, ctx: FrameContext) -> None:
        tc = FrameTimecode(ctx.index, self.fps)
        content_cuts = self.content.process_frame(tc, ctx.frame)
        fade_events = self.threshold.process_frame(tc, ctx.frame)

        (content_val,) = self._read_metrics(ctx.index)

        ctx.content_val = min(content_val / SCENE_CONTENT_SCALE, 1.0)
        ctx.shot_boundary = bool(content_cuts)

        self.cut_set.update(int(c) for c in content_cuts)
        self.fade_frames.extend(int(f) for f in fade_events)
        self.last_index = ctx.index

    def finalize(self) -> SceneProbeResult:
        last_tc = FrameTimecode(self.last_index, self.fps)
        self.cut_set.update(int(c) for c in (self.content.post_process(last_tc) or []))

        shots = self._build_shots()
        return SceneProbeResult(
            shots=shots,
            pacing=self._pacing(shots),
            fades=sorted(f / self.fps for f in set(self.fade_frames)),
        )

    # ---- internals ----
    def _read_metrics(self, index) -> tuple[float, ...]:
        if not self.stats.metrics_exist(index, self.KEYS):
            return (0.0,) * len(self.KEYS)
        vals = self.stats.get_metrics(index, self.KEYS)
        return tuple(v if v is not None else 0.0 for v in vals)

    def _build_shots(self) -> list[Shot]:
        starts = [0, *sorted(self.cut_set)]
        shots: list[Shot] = []
        for i, start in enumerate(starts):
            end = starts[i + 1] - 1 if i + 1 < len(starts) else self.last_index
            if end < start:
                continue
            shots.append(
                Shot(
                    start_s=start / self.fps,
                    end_s=(end + 1) / self.fps,
                    start_index=start,
                    end_index=end,
                )
            )
        return shots

    def _pacing(self, shots: list[Shot]) -> dict:
        if not shots:
            return {"shot_count": 0, "cuts_per_second": 0.0,
                    "avg_shot_s": 0.0, "min_shot_s": 0.0, "max_shot_s": 0.0}
        durations = [s.end_s - s.start_s for s in shots]
        total_s = (self.last_index + 1) / self.fps
        return {
            "shot_count": len(shots),
            "cuts_per_second": len(self.cut_set) / total_s if total_s else 0.0,
            "avg_shot_s": sum(durations) / len(durations),
            "min_shot_s": min(durations),
            "max_shot_s": max(durations),
        }