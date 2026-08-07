from typing import Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, StrictStr


class JobPayloadBase(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
    )

    job_type: Literal["video", "score"] = "video"


class VideoJobPayload(JobPayloadBase):
    request_id: StrictStr
    bucket: StrictStr
    video_path: StrictStr
    product_image_paths: list[str]
    logo_paths: list[str]


class RequestJobPayload(JobPayloadBase):
    job_type: Literal["score"]
    request_id: StrictStr
    batch_id: StrictStr


JobPayload: TypeAlias = VideoJobPayload | RequestJobPayload
