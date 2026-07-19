import json
import os
import subprocess
from urllib.parse import quote

import requests

from analyzer.types import Artifacts, Frame, VideoMetadata
from app.errors import PermanentError, TransientError
from app.schemas import JobPayload
from config.connection import get_storage_session
from config.settings import (
    AUDIO_SAMPLE_RATE,
    DOWNLOAD_CHUNK_SIZE,
    DOWNLOAD_TIMEOUT,
    FFMPEG_TIMEOUT,
    FFPROBE_TIMEOUT,
    SUPABASE_URL,
    logger,
)

class VideoPreprocessor:
    def __init__(self, job_payload: JobPayload, work_dir):
        self.job_payload = job_payload
        self.work_dir = work_dir

    # ---- public entry point ----
    def prepare(self) -> Artifacts:
        """Orchestrate the whole prep and return the artifacts bundle."""
        video_path = self._download_video()
        metadata = self._probe_metadata()
        audio_path = self._extract_audio()




    def _resolve_source(self):
        """request_id → (bucket, path). Look up in DB if payload lacks location."""

    def _download_video(self) -> str:
        """Fetch video from Supabase Storage into work_dir; return local path."""
        bucket = self.job_payload.bucket
        video_storage_path = self.job_payload.video_path

        object_path = "/".join(quote(seg) for seg in video_storage_path.split("/"))
        url = f"{SUPABASE_URL}/storage/v1/object/{quote(bucket)}/{object_path}"
        session = get_storage_session()

        ext = os.path.splitext(video_storage_path)[1]
        if not ext:
            raise PermanentError("Video extension not available")
        local_path = os.path.join(self.work_dir, f"video{ext}")
        logger.info("Downloading video %s/%s", bucket, video_storage_path)

        try:
            with session.get(
                url, stream=True, timeout=DOWNLOAD_TIMEOUT
            ) as response:
                response.raise_for_status()
                with open(local_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                        f.write(chunk)
        except requests.Timeout as e:
            raise TransientError(f"Video download timed out: {e}")
        except requests.HTTPError as e:
            code = e.response.status_code
            if code == 404:
                raise PermanentError(
                    f"Video not found: {bucket}/{video_storage_path}"
                )
            if code in (401, 403):
                raise PermanentError(f"Storage access denied ({code}): {e}")
            if code in (408, 429) or code >= 500:
                raise TransientError(f"Storage temporarily unavailable ({code}): {e}")
            raise PermanentError(f"Video download failed ({code}): {e}")
        except requests.RequestException as e:
            raise TransientError(f"Video download connection error: {e}")

        return local_path

    def _probe_metadata(self, video_path) -> VideoMetadata:
        """duration, fps, width, height, size — via ffprobe."""
        cmd = [
            "ffprobe",
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            video_path,
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=FFPROBE_TIMEOUT,
                check=True,
            )
        except FileNotFoundError:
            raise PermanentError("ffprobe executable not found")
        except subprocess.TimeoutExpired:
            raise TransientError("ffprobe timed out")
        except subprocess.CalledProcessError as e:
            raise PermanentError(f"ffprobe failed to read video: {e.stderr.strip()}")

        try:
            probe = json.loads(result.stdout)
        except json.JSONDecodeError as e:
            raise PermanentError(f"ffprobe returned invalid JSON: {e}")

        fmt = probe.get("format", {})
        streams = probe.get("streams", [])
        video_stream = next(
            (s for s in streams if s.get("codec_type") == "video"), None
        )
        if video_stream is None:
            raise PermanentError("No video stream found in file")

        return VideoMetadata(
            duration_s= float(fmt["duration"]),
            fps=self._parse_fps(video_stream),
            width=int(video_stream["width"]),
            height=int(video_stream["height"]),
            size_bytes=int(fmt["size"]),
        )

    @staticmethod
    def _parse_fps(video_stream) -> float:
        """Parse ffprobe frame-rate ('num/den') into fps, preferring avg_frame_rate."""
        for key in ("avg_frame_rate", "r_frame_rate"):
            rate = video_stream.get(key)
            if not rate or rate == "0/0":
                continue
            num, _, den = rate.partition("/")
            den_val = float(den) if den else 1.0
            if den_val:
                return float(num) / den_val
        raise PermanentError("Could not determine video frame rate")

    def _extract_audio(self, video_path) -> str:
        """Pull audio track to a file (for Whisper); return audio path."""
        audio_path = os.path.join(self.work_dir, "audio.wav")
        cmd = [
            "ffmpeg",
            "-v", "error",
            "-y",
            "-i", video_path,
            "-vn",         
            "-acodec", "pcm_s16le",
            "-ar", str(AUDIO_SAMPLE_RATE),
            "-ac", "1",
            audio_path,
        ]
        logger.info("Extracting audio from %s", video_path)

        try:
            subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=FFMPEG_TIMEOUT,
                check=True,
            )
        except FileNotFoundError:
            raise PermanentError("ffmpeg executable not found")
        except subprocess.TimeoutExpired:
            raise TransientError("ffmpeg audio extraction timed out")
        except subprocess.CalledProcessError as e:
            raise PermanentError(f"ffmpeg failed to extract audio: {e.stderr.strip()}")

        return audio_path

    def _sample_frames(self, video_path) -> list[Frame]:
        """Decode, sample (1fps / keyframes), write JPEGs; return frames+timestamps."""

    # Might be needed to pass the video link to gemini so their service is able to access a public video and analyse it 
    # def _signed_url(self) -> str | None:
    #     """Optional: signed URL for APIs that fetch by URL (Replicate)."""
        