from typing import ClassVar, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict




# ---------------------------------------------------------------------------
# General "video_processing" table models
# ---------------------------------------------------------------------------
class TaskSuccess(BaseModel):
    request_id: str
    task_name: str
    status: Literal["success"] = "success"
    result_table: str
    error: None = None

class TaskFailure(BaseModel):
    request_id: str
    task_name: str
    status: Literal["error"] = "error"
    result_table: None = None
    error: str


# ---------------------------------------------------------------------------
# Task-specific output models
# ---------------------------------------------------------------------------

class TaskRow(BaseModel):
    """One row of a task-specific results table."""
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

TRow = TypeVar("TRow", bound=TaskRow)
class TaskResult(BaseModel, Generic[TRow]):
    """Uniform envelope every analysis task returns."""
    table: ClassVar[str]
    rows: list[TRow]

# ==============================================
#  transcription  ->  transcript_segments
# ==============================================

class TranscriptSegment(TaskRow):  
    segment_id: str
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None

class TranscriptionResult(TaskResult[TranscriptSegment]):
    table: ClassVar[str] = "transcript_segments"


# ==============================================
#  ocr  ->  ocr_items
# ==============================================

class OcrItem(TaskRow):
    pass

class OcrResult(TaskResult[OcrItem]):
    table: ClassVar[str] = "ocr_items" #Table name should be updated to the actual name


# ==============================================
#  product_detection  ->  product_frames
# ==============================================

class ProductFrameRow(TaskRow):
    frame_id: str
    timestamp_ms: int
    location: dict | None = None
    confidence_score: float
    prominence: Literal[
        "foreground_in_use", "foreground_static", "background", "not_visible"
    ]
    focus_quality: Literal["sharp", "soft_focus", "blurry"] | None = None
    framing: Literal[
        "fully_visible", "partially_cropped", "heavily_obscured"
    ] | None = None

class ProductFrameResult(TaskResult[ProductFrameRow]):
    table: ClassVar[str] = "product_frames"


# ==============================================
#  logo_detection  ->  logo_frames
# ==============================================

class LogoFrameRow(TaskRow):
    frame_id: str
    timestamp_ms: int
    location: dict | None = None
    confidence_score: float
    prominence: Literal[
        "large_central", "small_corner", "background_signage", "absent"
    ]
    reference_match: Literal[
        "matches_reference", "differs_from_reference", "cannot_determine"
    ]

class LogoFrameResult(TaskResult[LogoFrameRow]):
    table: ClassVar[str] = "logo_frames"


# ==============================================
#  context  ->  visual_frames
# ==============================================

class PeopleInfo(BaseModel):
    count: int
    apparent_ages: list[str] = []
    apparent_presentation: list[str] = []
    activity: str
    clothing_style: str

class ColorPalette(BaseModel):
    dominant_colors: list[str] = []
    lighting_quality: str

class SceneBackground(BaseModel):
    location_type: str
    mood: str

TechnicalFlag = Literal[
    "ai_artifacts", "poor_framing_lighting", "jarring_transitions", "illegible_text"
]

class VisualFrameRow(TaskRow):
    frame_id: str
    timestamp_ms: int
    image_url: str | None = None
    action: str
    framing_composition: str | None = None
    people: PeopleInfo | None = None
    color_palette: ColorPalette | None = None
    background: SceneBackground | None = None
    technical_flags: list[TechnicalFlag] = []
    shot_index: int | None = None
    is_shot_start: bool = False
    is_fade: bool = False

class VisualFrameResult(TaskResult[VisualFrameRow]):
    table: ClassVar[str] = "visual_frames"


