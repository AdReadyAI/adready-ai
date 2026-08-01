
import cv2

from analyzer.object_detector import Detection
from analyzer.types import Frame
from config.settings import (
    FOCUS_BLURRY_MAX,
    FOCUS_SHARP_MIN,
    FRAMING_EDGE_MARGIN_FRAC,
    LOGO_DETECTION_CONFIDENCE,
    PROMINENCE_BACKGROUND_AREA_FRAC,
    PROMINENCE_LARGE_AREA_FRAC,
)


def frame_id(prefix: str, frame: Frame) -> str:
    return f"{prefix}_{frame.index:06d}"


def timestamp_ms(frame: Frame) -> int:
    return round(frame.timestamp * 1000)


def location(detection: Detection) -> dict:
    return {"x": detection.x, "y": detection.y, "w": detection.w, "h": detection.h}


def framing(detection: Detection) -> str:
    left = detection.x - detection.w / 2
    right = detection.x + detection.w / 2
    top = detection.y - detection.h / 2
    bottom = detection.y + detection.h / 2

    touching = sum(
        1
        for edge in (
            left <= FRAMING_EDGE_MARGIN_FRAC,
            right >= 1 - FRAMING_EDGE_MARGIN_FRAC,
            top <= FRAMING_EDGE_MARGIN_FRAC,
            bottom >= 1 - FRAMING_EDGE_MARGIN_FRAC,
        )
        if edge
    )
    if touching >= 2:
        return "heavily_obscured"
    if touching == 1:
        return "partially_cropped"
    return "fully_visible"


def near_corner(detection: Detection) -> bool:
    """Whether the bbox center sits near one of the four frame corners."""
    near_x = detection.x <= 0.25 or detection.x >= 0.75
    near_y = detection.y <= 0.25 or detection.y >= 0.75
    return near_x and near_y


def product_prominence(detection: Detection) -> str:
    area = detection.w * detection.h
    if area >= PROMINENCE_LARGE_AREA_FRAC:
        return "foreground_static"
    return "background"


def logo_prominence(detection: Detection) -> str:
    area = detection.w * detection.h
    if area >= PROMINENCE_LARGE_AREA_FRAC:
        return "large_central"
    if area >= PROMINENCE_BACKGROUND_AREA_FRAC and near_corner(detection):
        return "small_corner"
    return "background_signage"


def reference_match_label(confidence: float) -> str:
    if confidence >= LOGO_DETECTION_CONFIDENCE:
        return "matches_reference"
    return "cannot_determine"


def focus_quality(frame_path: str, detection: Detection) -> str | None:
    """Laplacian-variance sharpness on the cropped bbox region."""
    image = cv2.imread(frame_path)
    if image is None:
        return None

    height, width = image.shape[:2]
    left = max(0, round((detection.x - detection.w / 2) * width))
    right = min(width, round((detection.x + detection.w / 2) * width))
    top = max(0, round((detection.y - detection.h / 2) * height))
    bottom = min(height, round((detection.y + detection.h / 2) * height))
    if right <= left or bottom <= top:
        return None

    crop = cv2.cvtColor(image[top:bottom, left:right], cv2.COLOR_BGR2GRAY)
    variance = cv2.Laplacian(crop, cv2.CV_64F).var()

    if variance >= FOCUS_SHARP_MIN:
        return "sharp"
    if variance >= FOCUS_BLURRY_MAX:
        return "soft_focus"
    return "blurry"
