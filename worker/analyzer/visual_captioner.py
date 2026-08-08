import base64
import io

import openai
from PIL import Image
from pydantic import BaseModel, ValidationError

from analyzer.output_models import ColorPalette, PeopleInfo, SceneBackground, TechnicalFlag
from app.errors import PermanentError, TransientError
from config.connection import get_openrouter_client
from config.settings import (
    OPENROUTER_VISION_MODEL,
    OPENROUTER_VISION_TIMEOUT,
    VISUAL_CAPTION_LONG_SIDE,
    VISUAL_CAPTION_MAX_TOKENS,
)


class VisualCaptionOutput(BaseModel):
    """VLM-produced fields for one frame; `context()` fills in the rest of `VisualFrameRow`."""

    action: str
    framing_composition: str | None = None
    people: PeopleInfo | None = None
    color_palette: ColorPalette | None = None
    background: SceneBackground | None = None
    technical_flags: list[TechnicalFlag] = []


SYSTEM_PROMPT = """You are analyzing a single video frame from an advertisement. Describe only
what is visible in THIS exact image — do not guess about other parts of the
video you cannot see.

Return a JSON object with these fields:

- "action" (required, 1 short sentence): what is happening right now in this
  frame — the main visible action or activity.
- "framing_composition" (1 short phrase, or null if not clearly
  determinable): the shot type and composition, e.g. "close-up on product",
  "medium shot, subject centered", "wide shot, subject in lower third".
- "people" (object, or null if no people are visible in this frame):
  - "count" (integer): number of people visible.
  - "apparent_ages" (list of strings): apparent age range(s) of the people
    visible, e.g. ["adult"], ["child", "adult"].
  - "apparent_presentation" (list of strings): apparent gender presentation,
    e.g. ["woman"], ["man", "woman"].
  - "activity" (string): what the people are doing.
  - "clothing_style" (string): brief description of clothing/style.
- "color_palette" (object, or null if not clearly determinable):
  - "dominant_colors" (list of strings): the 2-4 most dominant colors in the
    frame.
  - "lighting_quality" (string): brief description of the lighting, e.g.
    "bright and even", "dim and moody", "harsh overexposed".
- "background" (object, or null if not clearly determinable):
  - "location_type" (string): the setting, e.g. "kitchen", "outdoor park",
    "studio with plain backdrop".
  - "mood" (string): the overall mood/atmosphere of the setting, e.g.
    "cozy", "energetic", "clinical".
- "technical_flags" (list of strings, empty list if none apply): only
  include a flag if you are confident it is genuinely visible in THIS frame.
  Default to an empty list — do not flag minor or ambiguous issues. Allowed
  values only:
  - "ai_artifacts": a visible defect, not just "this looks AI-generated" —
    wrong anatomy (extra/missing fingers, merged limbs), texture
    warping/melting, impossible geometry, flickering/uncanny distortion.
  - "poor_framing_lighting": looks like a mistake, not a stylistic choice —
    subject's head/face cropped out unintentionally, scene so
    dark/blown-out the subject/product is unreadable, subject clearly and
    unintentionally off-frame.
  - "jarring_transitions": ONLY assess this if you are told this frame is
    the first frame after a cut. Flag only a genuinely broken cut —
    mismatched color grade/temperature between shots, a stray flash/white
    frame, a visibly glitchy edit. A normal clean cut is NOT jarring just
    because it exists.
  - "illegible_text": only if this frame contains visible on-screen text
    (caption, disclaimer, CTA, etc.) that is blurry, too small,
    low-contrast, or partially cut off. If there is no on-screen text in
    this frame, do not include this flag."""


STRUCTURED_OUTPUT_MAX_ATTEMPTS = 2


def _b64(frame_path: str) -> str:
    """Downscale `frame_path` to a `VISUAL_CAPTION_LONG_SIDE` long-side cap (never upscale),
    re-encode as JPEG in memory, and return the base64-encoded bytes."""
    with Image.open(frame_path) as image:
        width, height = image.size
        long_side = max(width, height)
        if long_side > VISUAL_CAPTION_LONG_SIDE:
            scale = VISUAL_CAPTION_LONG_SIDE / long_side
            image = image.resize(
                (round(width * scale), round(height * scale)), Image.Resampling.LANCZOS
            )
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")


class VisualCaptioner:
    """Wraps one OpenRouter vision request that captions a single video frame."""

    def __init__(self, model: str | None = None) -> None:
        self._client = get_openrouter_client()
        self._model = model or OPENROUTER_VISION_MODEL

    def caption(self, frame_path: str, *, is_shot_start: bool) -> VisualCaptionOutput:
        """Caption `frame_path`, returning a validated `VisualCaptionOutput`."""
        shot_context_line = (
            "This frame is the first frame immediately after a cut."
            if is_shot_start
            else "This frame is a continuation within an existing shot."
        )
        encoded = _b64(frame_path)

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": shot_context_line},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
                    },
                ],
            },
        ]

        # Retry once at this per-frame boundary so a temporary malformed model response
        # does not become a permanently empty row in the downstream evidence bundle.
        for attempt in range(STRUCTURED_OUTPUT_MAX_ATTEMPTS):
            try:
                completion = self._client.chat.completions.parse(
                    model=self._model,
                    messages=messages,
                    response_format=VisualCaptionOutput,
                    timeout=OPENROUTER_VISION_TIMEOUT,
                    max_tokens=VISUAL_CAPTION_MAX_TOKENS,
                )
                break
            except ValidationError as e:
                if not any(error["type"] == "json_invalid" for error in e.errors()):
                    raise PermanentError(f"Unexpected error in caption: {e}") from e
                if attempt + 1 == STRUCTURED_OUTPUT_MAX_ATTEMPTS:
                    raise TransientError(
                        f"OpenRouter vision returned incomplete structured output: {e}"
                    ) from e
            except openai.LengthFinishReasonError as e:
                if attempt + 1 == STRUCTURED_OUTPUT_MAX_ATTEMPTS:
                    raise TransientError(
                        f"OpenRouter vision returned incomplete structured output: {e}"
                    ) from e
            except openai.APITimeoutError as e:
                raise TransientError(f"OpenRouter vision request timed out: {e}")
            except openai.APIConnectionError as e:
                raise TransientError(f"OpenRouter vision connection error: {e}")
            except openai.RateLimitError as e:
                raise TransientError(f"OpenRouter vision rate limited: {e}")
            except openai.APIStatusError as e:
                code = e.status_code
                if code >= 500 or code == 429:
                    raise TransientError(f"OpenRouter vision temporarily unavailable ({code}): {e}")
                raise PermanentError(f"OpenRouter vision request failed ({code}): {e}")
            except Exception as e:
                raise PermanentError(f"Unexpected error in caption: {e}")

        parsed = completion.choices[0].message.parsed
        if parsed is None:
            raise PermanentError("OpenRouter vision request was refused (no parsed output)")

        return parsed
