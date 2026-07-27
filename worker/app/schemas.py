from pydantic import BaseModel

class JobPayload(BaseModel):
    request_id: str
    bucket: str
    video_path: str
    product_image_paths: list[str]
    logo_paths: list[str]