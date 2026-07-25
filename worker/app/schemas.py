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
    product_imgs_folder_path: str
    logo_imgs_folder_path: str