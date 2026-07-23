from dataclasses import dataclass
from typing import Literal

@dataclass(frozen=True)
class Frame:
    timestamp: float
    path: str

@dataclass(frozen=True)
class Artifacts:
    job_id: str
    ad_creative_id: str
    storage_ref: str

    # Might be used for gemini video analysis
    # signed_url: str | None 

    video_path: str
    audio_path: str
    frames: tuple[Frame, ...]

    duration_s: float
    # Presentation timestamps are authoritative. FPS is populated only when
    # Media Processing has verified the constant-frame-rate fallback.
    timing_source: Literal["presentation_timestamps", "constant_frame_rate"]
    frame_timestamps: tuple[float, ...]
    fps: float | None
    width: int
    height: int
    size_bytes: int
    work_dir: str
