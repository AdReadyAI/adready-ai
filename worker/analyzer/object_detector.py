import base64
from dataclasses import dataclass
from pathlib import Path

import requests
from PIL import Image

from app.errors import PermanentError, TransientError
from config.settings import ROBOFLOW_API_KEY, ROBOFLOW_OWLV2_URL, ROBOFLOW_TIMEOUT, logger


@dataclass
class Detection:
    """Best-match detection for one target frame, in normalized [0, 1] coords."""

    confidence: float
    x: float
    y: float
    w: float
    h: float


def _b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("utf-8")


class ReferenceDetector:
    """Wraps one Roboflow OWLv2 image-guided query against a fixed reference set."""

    def __init__(self, reference_paths: list[str], label: str) -> None:
        self.label = label
        self._training_data = []
        for path in reference_paths:
            with Image.open(path) as image:
                width, height = image.size
            self._training_data.append(
                {
                    "image": {"type": "base64", "value": _b64(path)},
                    "boxes": [
                        {"x": 0, "y": 0, "w": width, "h": height, "cls": label}
                    ],
                }
            )

    def detect(self, target_path: str, confidence: float) -> Detection | None:
        """Query OWLv2 for `target_path`; return the best detection or None."""
        if not self._training_data:
            return None
        if not ROBOFLOW_API_KEY:
            raise PermanentError("ROBOFLOW_API_KEY is not set")

        with Image.open(target_path) as image:
            width, height = image.size

        payload = {
            "api_key": ROBOFLOW_API_KEY,
            "image": {"type": "base64", "value": _b64(target_path)},
            "training_data": self._training_data,
            "confidence": confidence,
            "visualize_predictions": False,
        }

        try:
            response = requests.post(
                ROBOFLOW_OWLV2_URL, json=payload, timeout=ROBOFLOW_TIMEOUT
            )
            response.raise_for_status()
        except requests.Timeout as e:
            raise TransientError(f"OWLv2 request timed out: {e}")
        except requests.HTTPError as e:
            code = e.response.status_code
            if code in (401, 403):
                raise PermanentError(f"OWLv2 access denied ({code}): {e}")
            if code in (408, 429) or code >= 500:
                raise TransientError(f"OWLv2 temporarily unavailable ({code}): {e}")
            raise PermanentError(f"OWLv2 request failed ({code}): {e}")
        except requests.RequestException as e:
            raise TransientError(f"OWLv2 connection error: {e}")

        data = response.json()
        predictions = data.get("predictions", data)
        if not isinstance(predictions, list) or not predictions:
            return None

        best = max(predictions, key=lambda p: p.get("confidence", 0.0))
        try:
            return Detection(
                confidence=float(best["confidence"]),
                x=float(best["x"]) / width,
                y=float(best["y"]) / height,
                w=float(best["width"]) / width,
                h=float(best["height"]) / height,
            )
        except (KeyError, TypeError, ZeroDivisionError) as e:
            logger.warning("OWLv2 returned an unexpected prediction shape: %s", e)
            return None
