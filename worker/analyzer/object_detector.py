import base64
import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import requests
from PIL import Image

from app.errors import PermanentError, TransientError
from config.settings import ROBOFLOW_API_KEY, ROBOFLOW_OWLV2_URL, ROBOFLOW_TIMEOUT, REFERENCE_PADDING_RATIO, logger


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


def _tight_bbox(image: Image.Image, margin: float = 0.05) -> tuple[int, int, int, int]:
    arr = np.asarray(image.convert("RGB"), dtype=np.int16)
    height, width, _ = arr.shape
    corners = np.concatenate(
        [arr[0, :10], arr[-1, :10], arr[:10, 0], arr[:10, -1]]
    )
    background = corners.mean(axis=0)
    diff = np.abs(arr - background).sum(axis=2)
    mask = diff > 40
    if not mask.any():
        return width // 2, height // 2, width, height

    ys, xs = np.where(mask)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    pad_x, pad_y = int((x1 - x0) * margin), int((y1 - y0) * margin)
    x0, x1 = max(x0 - pad_x, 0), min(x1 + pad_x, width - 1)
    y0, y1 = max(y0 - pad_y, 0), min(y1 + pad_y, height - 1)

    box_w, box_h = x1 - x0, y1 - y0
    return x0 + box_w // 2, y0 + box_h // 2, box_w, box_h


def _padded_reference(image: Image.Image, pad_ratio: float = REFERENCE_PADDING_RATIO) -> tuple[Image.Image, tuple[int, int, int, int]]:
    rgb = image.convert("RGB")
    cx, cy, w, h = _tight_bbox(rgb)
    crop = rgb.crop((cx - w // 2, cy - h // 2, cx - w // 2 + w, cy - h // 2 + h))

    pad_w, pad_h = int(w * pad_ratio), int(h * pad_ratio)
    canvas = Image.new("RGB", (w + 2 * pad_w, h + 2 * pad_h), color=(255, 255, 255))
    canvas.paste(crop, (pad_w, pad_h))
    return canvas, (pad_w + w // 2, pad_h + h // 2, w, h)


def _image_b64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


class ReferenceDetector:
    """Wraps one Roboflow OWLv2 image-guided query against a fixed reference set."""

    def __init__(self, reference_paths: list[str], label: str) -> None:
        self.label = label
        self._training_data = []
        for path in reference_paths:
            with Image.open(path) as image:
                padded, (cx, cy, w, h) = _padded_reference(image)
            self._training_data.append(
                {
                    "image": {"type": "base64", "value": _image_b64(padded)},
                    "boxes": [
                        {"x": cx, "y": cy, "w": w, "h": h, "cls": label}
                    ],
                }
            )

    def detect(self, target_path: str, confidence: float) -> Detection | None:
        """Query OWLv2 for `target_path`; return the best detection or None."""
        predictions, (width, height) = self._query(target_path, confidence)
        if not predictions:
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

    def detect_all(self, target_path: str, confidence: float) -> list[Detection]:
        """Every OWLv2 prediction for `target_path` above `confidence`."""
        predictions, (width, height) = self._query(target_path, confidence)
        detections = []
        for p in predictions:
            try:
                detections.append(
                    Detection(
                        confidence=float(p["confidence"]),
                        x=float(p["x"]) / width,
                        y=float(p["y"]) / height,
                        w=float(p["width"]) / width,
                        h=float(p["height"]) / height,
                    )
                )
            except (KeyError, TypeError, ZeroDivisionError) as e:
                logger.warning("OWLv2 returned an unexpected prediction shape: %s", e)
        return detections

    def _query(self, target_path: str, confidence: float) -> tuple[list[dict], tuple[int, int]]:
        """Raw OWLv2 call; returns (predictions, (target_width, target_height))."""
        if not self._training_data:
            return [], (0, 0)
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
        if not isinstance(predictions, list):
            return [], (width, height)
        return predictions, (width, height)
