from pydantic import BaseModel

class JobPayload(BaseModel):
    request_id: str