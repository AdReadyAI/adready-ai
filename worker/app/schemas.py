from pydantic import BaseModel, ConfigDict, StrictStr

class JobPayload(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
    )

    request_id: StrictStr
    bucket: StrictStr
    video_path: StrictStr
    product_image_paths: list[str]
    logo_paths: list[str]
