from typing import Literal

from pydantic import BaseModel, ConfigDict, StrictStr, model_validator


class JobPayload(BaseModel):
    """Validated queue contract for either video processing or score projection."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
    )

    job_type: Literal["video", "score"] = "video"
    request_id: StrictStr
    bucket: StrictStr | None = None
    video_path: StrictStr | None = None
    product_image_paths: list[str] | None = None
    logo_paths: list[str] | None = None
    batch_id: StrictStr | None = None

    @model_validator(mode="after")
    def validate_payload_shape(self):
        if self.job_type == "video":
            missing = [
                field
                for field in ("bucket", "video_path", "product_image_paths", "logo_paths")
                if getattr(self, field) is None
            ]
            if missing:
                raise ValueError(
                    f"video job payload missing required field(s): {', '.join(missing)}"
                )
            if self.batch_id is not None:
                raise ValueError("video job payload must not include batch_id")
        else:
            if self.batch_id is None:
                raise ValueError("score job payload requires batch_id")
            if any(
                getattr(self, field) is not None
                for field in ("bucket", "video_path", "product_image_paths", "logo_paths")
            ):
                raise ValueError(
                    "score job payload must not include video-specific fields"
                )
        return self
