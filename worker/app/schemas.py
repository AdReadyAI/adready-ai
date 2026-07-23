from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# This registry is the worker-owned authority for queue validation. Later
# vertical slices can add an analysis without weakening the trusted boundary.
SUPPORTED_ANALYSES = frozenset({"ocr"})


class JobPayload(BaseModel):
    """Trusted Media Processing request consumed from the durable queue."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    request_id: UUID
    ad_creative_id: UUID
    ocr_run_id: UUID
    requested_analyses: tuple[str, ...] = Field(
        min_length=1,
        max_length=1,
    )
    bucket: str = Field(min_length=1)
    video_path: str = Field(min_length=1)
    product_imgs_folder_path: str = ""
    logo_imgs_folder_path: str = ""

    @field_validator("requested_analyses")
    @classmethod
    def validate_requested_analyses(cls, analyses: tuple[str, ...]) -> tuple[str, ...]:
        """Accept exactly the analyses currently implemented by this worker."""
        if len(set(analyses)) != len(analyses) or not set(analyses) <= SUPPORTED_ANALYSES:
            raise ValueError("requested_analyses contains an unsupported analysis")
        return analyses
