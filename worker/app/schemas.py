from pydantic import BaseModel

class JobPayload(BaseModel):
    request_id: str
    bucket: str
    video_path: str
    product_imgs_folder_path: str