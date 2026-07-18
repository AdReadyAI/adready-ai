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
#  object_detection  ->  object_detection_items
# ==============================================

class ObjectDetectionItem(TaskRow):
    pass

class ObjectDetectionResult(TaskResult[ObjectDetectionItem]):
    table: ClassVar[str] = "object_detection_items" #Table name should be updated to the actual name


# ==============================================
#  context  ->  context_results
# ==============================================

class ContextRow(TaskRow):
    pass

class ContextResult(TaskResult[ContextRow]):
    table: ClassVar[str] = "context_results" #Table name should be updated to the actual name


