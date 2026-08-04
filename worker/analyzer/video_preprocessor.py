import json
import os
import subprocess
from urllib.parse import quote

import requests

from analyzer.types import Artifacts, Frame, VideoMetadata
from analyzer.frame_sampling import FrameSampler
from analyzer.frame_sampling.base import ProbeResult
from app.errors import PermanentError, TransientError
from app.log_utils import phase
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
        self._probe_results: dict[str, ProbeResult] = {}
        self._has_audio = True

    # ---- public entry point ----
    def prepare(self) -> Artifacts:
        """Orchestrate the whole prep and return the artifacts bundle."""
        job_id = self.job_payload.request_id
        with phase(logger, f"[job {job_id}] Download video"):
            video_path = self._download_video()
        with phase(logger, f"[job {job_id}] Probe metadata"):
            metadata = self._probe_metadata(video_path)
        with phase(logger, f"[job {job_id}] Extract audio"):
            audio_path = self._extract_audio(video_path)
        with phase(logger, f"[job {job_id}] Download product images"):
            product_image_paths = self._download_reference_images(
                self.job_payload.product_image_paths, "product_images"
            )
        with phase(logger, f"[job {job_id}] Download logo images"):
            logo_paths = self._download_reference_images(
                self.job_payload.logo_paths, "logo_images"
            )
        with phase(logger, f"[job {job_id}] Frame sampling"):
            frames = self._sample_frames(
                video_path, metadata, product_image_paths, logo_paths
            )

        return Artifacts(
            job_id=self.job_payload.request_id,
            storage_ref=f"{self.job_payload.bucket}/{self.job_payload.video_path}",
            video_path=video_path,
            audio_path=audio_path,
            frames=tuple(frames),
            video_metadata=metadata,
            work_dir=self.work_dir,
            probe_results=self._probe_results,
            product_image_paths=tuple(product_image_paths),
            logo_paths=tuple(logo_paths),
        )

    def _download_object(self, storage_path: str, local_path: str, kind: str) -> None:
        """Fetch a single object from Supabase Storage to a local path."""
        bucket = self.job_payload.bucket
        object_path = "/".join(quote(seg) for seg in storage_path.split("/"))
        url = f"{SUPABASE_URL}/storage/v1/object/{quote(bucket)}/{object_path}"
        session = get_storage_session()

        try:
            with session.get(
                url, stream=True, timeout=DOWNLOAD_TIMEOUT
            ) as response:
                response.raise_for_status()
                with open(local_path, "wb") as f:
                    for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                        f.write(chunk)
        except requests.Timeout as e:
            raise TransientError(f"{kind} download timed out: {e}")
        except requests.HTTPError as e:
            code = e.response.status_code
            if code == 404:
                raise PermanentError(f"{kind} not found: {bucket}/{storage_path}")
            if code in (401, 403):
                raise PermanentError(f"Storage access denied ({code}): {e}")
            if code in (408, 429) or code >= 500:
                raise TransientError(f"Storage temporarily unavailable ({code}): {e}")
            raise PermanentError(f"{kind} download failed ({code}): {e}")
        except requests.RequestException as e:
            raise TransientError(f"{kind} download connection error: {e}")

    def _download_video(self) -> str:
        """Fetch video from Supabase Storage into work_dir; return local path."""
        video_storage_path = self.job_payload.video_path

        ext = os.path.splitext(video_storage_path)[1]
        if not ext:
            raise PermanentError("Video extension not available")
        local_path = os.path.join(self.work_dir, f"video{ext}")
        logger.info(
            "Downloading video %s/%s", self.job_payload.bucket, video_storage_path
        )

        self._download_object(video_storage_path, local_path, kind="Video")
        return local_path

    def _download_reference_images(
        self, storage_paths: list[str], subfolder: str
    ) -> list[str]:
        """Fetch reference product/logo images into a dedicated work_dir subfolder."""
        folder = os.path.join(self.work_dir, subfolder)
        os.makedirs(folder, exist_ok=True)

        local_paths = []
        for i, storage_path in enumerate(storage_paths):
            ext = os.path.splitext(storage_path)[1] or ".jpg"
            local_path = os.path.join(folder, f"{i}{ext}")
            logger.info(
                "Downloading %s %s/%s", subfolder, self.job_payload.bucket, storage_path
            )
            self._download_object(storage_path, local_path, kind=subfolder)
            local_paths.append(local_path)
        return local_paths

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

        self._has_audio = any(s.get("codec_type") == "audio" for s in streams)
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

    def _extract_audio(self, video_path) -> str | None:
        if not self._has_audio:
            logger.info("No audio stream in %s; skipping audio extraction", video_path)
            return None

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

    def _sample_frames(
        self,
        video_path,
        metadata: VideoMetadata,
        product_image_paths: list[str],
        logo_paths: list[str],
    ) -> list[Frame]:
        """Decode once and select tagged frames via the probe pipeline."""
        sampler = FrameSampler(
            video_path,
            metadata,
            self.work_dir,
            product_image_paths=product_image_paths,
            logo_paths=logo_paths,
        )
        frames = sampler.run()
        self._probe_results = sampler.probe_results
        return frames

    # Might be needed to pass the video link to gemini so their service is able to access a public video and analyse it 
    # def _signed_url(self) -> str | None:
    #     """Optional: signed URL for APIs that fetch by URL (Replicate)."""
