from analyzer.types import Artifacts, Frame

class VideoPreprocessor:
    def __init__(self, request_id, work_dir):
        self.request_id = request_id
        self.work_dir = work_dir

    # ---- public entry point ----
    def prepare(self) -> Artifacts:
        """Orchestrate the whole prep and return the artifacts bundle."""
        pass

    # ---- private steps ----
    def _resolve_source(self):
        """request_id → (bucket, path). Look up in DB if payload lacks location."""

    def _download_video(self) -> str:
        """Fetch video from Supabase Storage into work_dir; return local path."""

    def _probe_metadata(self, video_path) -> dict:
        """duration, fps, width, height, size — via ffprobe/opencv."""

    def _extract_audio(self, video_path) -> str:
        """Pull audio track to a file (for Whisper); return audio path."""

    def _sample_frames(self, video_path) -> list[Frame]:
        """Decode, sample (1fps / keyframes), write JPEGs; return frames+timestamps."""

    # Might be needed to pass the video link to gemini so their service is able to access a public video and analyse it 
    # def _signed_url(self) -> str | None:
    #     """Optional: signed URL for APIs that fetch by URL (Replicate)."""
        