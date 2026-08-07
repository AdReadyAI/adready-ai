from typing import Any, Literal

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


class _JobPayloadMeta(type(JobPayloadBase)):
    def __call__(cls, *args: Any, **kwargs: Any):
        if cls is JobPayload:
            if args and isinstance(args[0], dict):
                payload = dict(args[0])
            elif args and isinstance(args[0], JobPayloadBase):
                return args[0]
            elif len(args) == 1 and not kwargs:
                payload = dict(args[0]) if isinstance(args[0], dict) else {}
            else:
                payload = dict(kwargs)

            if payload.get("job_type") == "score":
                return RequestJobPayload(**payload)
            return VideoJobPayload(**payload)
        return super().__call__(*args, **kwargs)

    def __instancecheck__(cls, instance: Any) -> bool:
        if cls is JobPayload:
            return isinstance(instance, (VideoJobPayload, RequestJobPayload))
        return super().__instancecheck__(instance)


class JobPayload(JobPayloadBase, metaclass=_JobPayloadMeta):
    """Factory-style base for video and score payloads.

    Tests and callers expect to invoke JobPayload(...) directly while still
    allowing the parsed object to be treated as a common payload type.
    """

    @classmethod
    def model_validate(cls, obj: Any):
        if cls is JobPayload:
            if isinstance(obj, JobPayloadBase):
                return obj
            if isinstance(obj, dict):
                if obj.get("job_type") == "score":
                    return RequestJobPayload.model_validate(obj)
                return VideoJobPayload.model_validate(obj)
        return super().model_validate(obj)
