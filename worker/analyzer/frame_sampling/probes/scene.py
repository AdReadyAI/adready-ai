import numpy as np
from dataclasses import dataclass
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
    shots: list[Shot]

@register_probe(Stage.SCENE)
class SceneProbe(Probe):
    """Computes a per-frame content-change value and detects shot cuts."""

    name = "scene"

    def __init__(self):
        self.prev_small = None
        self.shots: list[Shot] = []
        self.frames_since_last_cut = 0
        self.current_shot_start_idx = 0
        self.current_shot_start_ts = 0.0

    def configure(self, setup) -> None:
        self.fps = setup.video_metadata.fps

    def process(self, ctx: FrameContext) -> None:
        
        if self.prev_small is None:
            content_val = 0.0
        else:
            
            diff = np.abs(ctx.small.astype(np.float32) - self.prev_small.astype(np.float32))
            magnitude = np.sum(diff)
            print(f"DEBUG: Frame {ctx.index} | Raw Magnitude: {magnitude}")
            content_val = min(magnitude / SCENE_CONTENT_SCALE, 1.0)

        ctx.content_val = content_val
        
        
        is_cut = (content_val > SCENE_CUT_THRESHOLD and 
                  self.frames_since_last_cut >= SCENE_MIN_SHOT_FRAMES)
        
        
        if ctx.index == 0:
            is_cut = False

        if is_cut:
            ctx.shot_boundary = True
            
            self.shots.append(Shot(
                start_s=self.current_shot_start_ts,
                end_s=ctx.timestamp,
                start_index=self.current_shot_start_idx,
                end_index=ctx.index - 1
            ))
            
            self.current_shot_start_idx = ctx.index
            self.current_shot_start_ts = ctx.timestamp
            self.frames_since_last_cut = 0
        else:
            ctx.shot_boundary = False

        
        self.prev_small = ctx.small.copy()
        self.frames_since_last_cut += 1

    def finalize(self) -> SceneProbeResult:
        return SceneProbeResult(shots=self.shots)