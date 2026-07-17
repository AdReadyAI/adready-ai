from typing import ClassVar, Literal

from pydantic import BaseModel


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
    table: ClassVar[str]

# ==============================================
#  transcription  ->  transcript_segments
# ==============================================

class TranscriptSegment(TaskRow):
    table: ClassVar[str] = "transcript_segments"
    segment_id: str
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None


# ==============================================
#  frame_text  ->  frame_text_items
# ==============================================




# ==============================================
#  object_detection  ->  object_detection_items
# ==============================================





# ==============================================
#  context  ->  context_results
# ==============================================


