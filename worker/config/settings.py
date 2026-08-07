import os
import logging

MODE = os.environ.get("MODE", "prod").lower()
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
DEBUG = LOG_LEVEL == "DEBUG"

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("worker")

DATABASE_URL = os.environ["DATABASE_URL"]
QUEUE_NAME = os.environ.get("QUEUE_NAME", "jobs")
CHANNEL_NAME = os.environ.get("CHANNEL_NAME", "new_job")
VISIBILITY_TIMEOUT = 60
HEARTBEAT_INTERVAL = 20
POLL_TIMEOUT = 5
MAX_RETRIES = 3
ANALYSIS_TASK_MAX_ATTEMPTS = 3
RETRY_BASE_DELAY = 5

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# Vision model for captioning — unvalidated starting point, tune once real outputs can be reviewed.
OPENROUTER_VISION_MODEL = os.getenv("OPENROUTER_VISION_MODEL", "google/gemini-2.5-flash")
OPENROUTER_VISION_TIMEOUT = 30
# matches FrameSampler's analysis long-side cap
VISUAL_CAPTION_LONG_SIDE = 384
# unvalidated starting point — tune once real OpenRouter rate limits are known
VISUAL_CAPTION_MAX_WORKERS = 4

ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
# Narrow credential for invoking internal Edge Functions. Keep it separate from
# the service-role key so function access does not grant direct database access.
INTERNAL_TRIGGER_SECRET = os.environ["INTERNAL_TRIGGER_SECRET"]
DOWNLOAD_TIMEOUT = 60
DOWNLOAD_CHUNK_SIZE = 1 << 20  # 1 MB
FFPROBE_TIMEOUT = 30
FFMPEG_TIMEOUT = 120
AUDIO_SAMPLE_RATE = 16000

ADAPTIVE_KEYFRAME_THRESHOLD = 0.5
ADAPTIVE_MIN_GAP_S = 0.2
ADAPTIVE_MAX_GAP_S = 2.0




SCENE_CUT_THRESHOLD = 27.0  
SCENE_CONTENT_SCALE = 100.0    # Still not sure about the exact value wasn't able to find anything on line
SCENE_MIN_SHOT_FRAMES = 12

# Dynamism thresholds on avg content_val (0-1, excluding shot-boundary
# frames) — unvalidated starting points, tune against real ad footage once
# flagged videos can be reviewed (same spirit as QUALITY_*/FOCUS_* above).
DYNAMISM_MOSTLY_STATIC_MAX = 0.15
DYNAMISM_MODERATE_MAX = 0.45


# QualityProbe (Layer-A) thresholds — unvalidated starting points, tune against
# real ad footage once flagged frames can be reviewed.
QUALITY_SHARPNESS_MIN = 60.0          # Laplacian variance; below = blur
QUALITY_EXPOSURE_CLIP_FRAC = 0.05     # fraction of pixels crushed/blown to flag
QUALITY_EXPOSURE_MEAN_MIN = 12.0      # mean luma (0-255) below = near-black frame
QUALITY_CONTRAST_MIN = 12.0           # luma std-dev below = flat/washed-out
QUALITY_NOISE_MAX = 6.0               # median-residual std above = grainy
QUALITY_BLOCKINESS_MAX = 1.8          # boundary/overall gradient-energy ratio above = blocky
QUALITY_TEMPORAL_SPIKE_MAX = 25.0     # frame-to-frame mean-luma delta above = cut/flicker
QUALITY_TEMPORAL_FREEZE_MIN = 0.5     # delta below = frame effectively unchanged
QUALITY_FREEZE_MIN_FRAMES = 8         # consecutive unchanged frames before calling it frozen






# Frame-sampling model weights
WARM_MODELS = os.getenv("WARM_MODELS", "true").lower() in ("1", "true", "yes")

EAST_MODEL_PATH = os.getenv(
    "EAST_MODEL_PATH", "/app/assets/models/frozen_east_text_detection.pb"
)
MOBILECLIP_MODEL_NAME = os.getenv("MOBILECLIP_MODEL_NAME", "MobileCLIP2-S0")
MOBILECLIP_PRETRAINED_TAG = os.getenv("MOBILECLIP_PRETRAINED_TAG", "dfndr2b")

# Roboflow OWLv2 image-guided detection (real bbox confirmation on candidate
# frames already gated by ReferenceMatchProbe/ProductProbe/LogoProbe).
ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY")
ROBOFLOW_OWLV2_URL = os.getenv(
    "ROBOFLOW_OWLV2_URL", "https://infer.roboflow.com/owlv2/infer"
)
ROBOFLOW_TIMEOUT = 30
REFERENCE_DETECTION_MAX_WORKERS = 8

# Detection confidence thresholds — unvalidated starting points, tune against
# real ad footage once flagged detections can be reviewed.
PRODUCT_DETECTION_CONFIDENCE = 0.85
LOGO_DETECTION_CONFIDENCE = 0.95
LOGO_DETECTION_LOW_CONFIDENCE = 0.90
REFERENCE_PADDING_RATIO = 0.5

# Prominence heuristics — fraction of frame area covered by the detected bbox.
PROMINENCE_LARGE_AREA_FRAC = 0.15
PROMINENCE_BACKGROUND_AREA_FRAC = 0.02

# Framing heuristic — how close (as a fraction of frame width/height) a bbox
# edge must be to the frame boundary to count as touching/cropped.
FRAMING_EDGE_MARGIN_FRAC = 0.02

# Focus-quality heuristic (Laplacian variance on the cropped bbox region,
# same metric as QualityProbe but tuned for small crops rather than full
# frames — unvalidated starting points).
FOCUS_SHARP_MIN = 60.0
FOCUS_BLURRY_MAX = 20.0
