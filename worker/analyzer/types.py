from dataclasses import dataclass

@dataclass(frozen=True)
class Frame:
    timestamp: float
    path: str

@dataclass
class VideoMetadata:
    duration_s: float
    fps: float
    width: int
    height: int
    size_bytes: int

@dataclass(frozen=True)
class Artifacts:
    job_id: str
    storage_ref: str

    # Might be used for gemini video analysis
    # signed_url: str | None 

    video_path: str
    audio_path: str
    frames: tuple[Frame, ...]

    video_metadata: VideoMetadata
    work_dir: str   

