"""Download and inspect an Ad Creative before provider-backed analysis."""

import json
import math
from fractions import Fraction
from pathlib import Path
import subprocess
from urllib.parse import quote

import requests

from analyzer.types import Artifacts
from config.errors import PermanentError, TransientError
from config.settings import (
    DOWNLOAD_CHUNK_SIZE,
    DOWNLOAD_TIMEOUT,
    FFPROBE_TIMEOUT,
    SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL,
)


class VideoPreprocessor:
    """Prepare the trusted Ad Creative identified by a queue payload."""

    def __init__(self, payload, work_dir):
        self.payload = payload
        self.work_dir = Path(work_dir)

    def prepare(self) -> Artifacts:
        """Download, decode, and establish the media timing contract."""
        video_path = self._download_video()
        metadata = self._probe_metadata(video_path)

        return Artifacts(
            job_id=str(self.payload.ocr_run_id),
            ad_creative_id=str(self.payload.ad_creative_id),
            storage_ref=f"{self.payload.bucket}/{self.payload.video_path}",
            video_path=str(video_path),
            # Audio extraction and sampled frames belong to later vertical slices.
            audio_path="",
            frames=(),
            duration_s=metadata["duration_s"],
            timing_source=metadata["timing_source"],
            frame_timestamps=metadata["frame_timestamps"],
            fps=metadata["fps"],
            width=metadata["width"],
            height=metadata["height"],
            size_bytes=metadata["size_bytes"],
            work_dir=str(self.work_dir),
        )

    def _download_video(self) -> Path:
        """Stream the private Storage object into the run's temporary directory."""
        base_url = SUPABASE_URL
        service_key = SUPABASE_SERVICE_ROLE_KEY
        if not base_url or not service_key:
            raise PermanentError("Media Storage is not configured")

        # Quote each identity component so caller-controlled paths cannot alter
        # the Storage endpoint while preserving legitimate nested object paths.
        bucket = quote(self.payload.bucket, safe="")
        object_path = quote(self.payload.video_path, safe="/")
        url = f"{base_url.rstrip('/')}/storage/v1/object/{bucket}/{object_path}"
        target = self.work_dir / "source-video"

        try:
            response = requests.get(
                url,
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                },
                stream=True,
                timeout=DOWNLOAD_TIMEOUT,
            )
            if response.status_code == 429 or response.status_code >= 500:
                raise TransientError("Media Storage is temporarily unavailable")
            response.raise_for_status()
            with target.open("wb") as output:
                # Streaming bounds memory use for the worker's 1 GB environment.
                for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                    if chunk:
                        output.write(chunk)
        except (requests.Timeout, requests.ConnectionError) as exc:
            raise TransientError("Media Storage download failed") from exc
        except requests.HTTPError as exc:
            raise PermanentError("Ad Creative source could not be downloaded") from exc

        return target

    def _probe_metadata(self, video_path: Path) -> dict:
        """Use ffprobe to validate decoding and prefer presentation timestamps."""
        command = [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_frames",
            "-show_entries",
            (
                "format=duration,size:"
                "stream=codec_type,width,height,avg_frame_rate,r_frame_rate:"
                "frame=best_effort_timestamp_time,pkt_duration_time"
            ),
            "-of",
            "json",
            str(video_path),
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=FFPROBE_TIMEOUT,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PermanentError("Ad Creative could not be decoded") from exc

        if result.returncode != 0:
            raise PermanentError("Ad Creative could not be decoded")

        try:
            probe = json.loads(result.stdout)
            stream = next(
                item
                for item in probe.get("streams", ())
                if item.get("codec_type") == "video"
            )
            duration_s = float(probe["format"]["duration"])
            width = int(stream["width"])
            height = int(stream["height"])
            size_bytes = int(probe["format"].get("size", video_path.stat().st_size))
        except (KeyError, TypeError, ValueError, StopIteration, json.JSONDecodeError) as exc:
            raise PermanentError("Ad Creative has invalid media metadata") from exc

        if not math.isfinite(duration_s) or duration_s <= 0 or duration_s > 60:
            raise PermanentError("Ad Creative duration must be between 0 and 60 seconds")
        if width <= 0 or height <= 0:
            raise PermanentError("Ad Creative dimensions must be positive")

        timestamps = self._presentation_timestamps(probe.get("frames", ()))
        if timestamps:
            return {
                "duration_s": duration_s,
                "timing_source": "presentation_timestamps",
                "frame_timestamps": timestamps,
                "fps": None,
                "width": width,
                "height": height,
                "size_bytes": size_bytes,
            }

        fps = self._constant_frame_rate(stream, probe.get("frames", ()))
        return {
            "duration_s": duration_s,
            "timing_source": "constant_frame_rate",
            "frame_timestamps": (),
            "fps": fps,
            "width": width,
            "height": height,
            "size_bytes": size_bytes,
        }

    @staticmethod
    def _presentation_timestamps(frames) -> tuple[float, ...]:
        """Return finite, monotonic PTS values or reject a malformed sequence."""
        timestamps = []
        for frame in frames:
            raw_timestamp = frame.get("best_effort_timestamp_time")
            if raw_timestamp is None:
                # A partial sequence cannot preserve source-frame alignment.
                return ()
            try:
                timestamp = float(raw_timestamp)
            except (TypeError, ValueError) as exc:
                raise PermanentError("Ad Creative has invalid presentation timestamps") from exc
            if (
                not math.isfinite(timestamp)
                or timestamp < 0
                or (timestamps and timestamp < timestamps[-1])
            ):
                raise PermanentError("Ad Creative has invalid presentation timestamps")
            timestamps.append(timestamp)
        return tuple(timestamps)

    @staticmethod
    def _constant_frame_rate(stream, frames) -> float:
        """Validate decoded frame durations for the explicit CFR fallback."""
        try:
            average_rate = Fraction(stream["avg_frame_rate"])
            real_rate = Fraction(stream["r_frame_rate"])
            durations = tuple(
                float(frame["pkt_duration_time"])
                for frame in frames
            )
        except (KeyError, ValueError, ZeroDivisionError) as exc:
            raise PermanentError(
                "Ad Creative lacks valid presentation timestamps"
            ) from exc

        if (
            average_rate <= 0
            or average_rate != real_rate
            or not durations
            or any(not math.isfinite(duration) or duration <= 0 for duration in durations)
        ):
            raise PermanentError(
                "Ad Creative lacks presentation timestamps and verified constant FPS"
            )

        # ffprobe rounds time-base values, so allow one microsecond of variation
        # while still requiring every decoded frame interval to be constant.
        if max(durations) - min(durations) > 1e-6:
            raise PermanentError(
                "Ad Creative lacks presentation timestamps and verified constant FPS"
            )
        return float(average_rate)
