"""Unit tests for detection_heuristics.py (product/logo row-building rules)."""

import numpy as np
import cv2
import pytest

pytestmark = pytest.mark.unit

from analyzer import detection_heuristics as dh
from analyzer.object_detector import Detection
from analyzer.types import Frame


# ---- frame_id / timestamp_ms / location ----
def test_frame_id_uses_frame_index():
    frame = Frame(index=42, timestamp=1.0, path="whatever.jpg")
    assert dh.frame_id("p", frame) == "p_000042"
    assert dh.frame_id("l", frame) == "l_000042"


def test_timestamp_ms_rounds_seconds_to_milliseconds():
    frame = Frame(index=0, timestamp=1.234, path="f.jpg")
    assert dh.timestamp_ms(frame) == 1234


def test_location_returns_normalized_bbox_dict():
    detection = Detection(confidence=0.9, x=0.1, y=0.2, w=0.3, h=0.4)
    assert dh.location(detection) == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}


# ---- framing ----
def test_framing_fully_visible_when_bbox_away_from_edges():
    detection = Detection(confidence=0.9, x=0.5, y=0.5, w=0.2, h=0.2)
    assert dh.framing(detection) == "fully_visible"


def test_framing_partially_cropped_when_one_edge_touched():
    detection = Detection(confidence=0.9, x=0.0, y=0.5, w=0.2, h=0.2)
    assert dh.framing(detection) == "partially_cropped"


def test_framing_heavily_obscured_when_two_edges_touched():
    detection = Detection(confidence=0.9, x=0.0, y=0.0, w=0.2, h=0.2)
    assert dh.framing(detection) == "heavily_obscured"


# ---- near_corner ----
def test_near_corner_true_for_corner_position():
    assert dh.near_corner(Detection(confidence=0.9, x=0.1, y=0.1, w=0.05, h=0.05))


def test_near_corner_false_for_center_position():
    assert not dh.near_corner(Detection(confidence=0.9, x=0.5, y=0.5, w=0.05, h=0.05))


# ---- product_prominence / logo_prominence / reference_match_label ----
def test_product_prominence_large_area_is_foreground_static():
    assert dh.product_prominence(Detection(confidence=0.9, x=0.5, y=0.5, w=0.5, h=0.5)) == "foreground_static"


def test_product_prominence_small_area_is_background():
    assert dh.product_prominence(Detection(confidence=0.9, x=0.5, y=0.5, w=0.05, h=0.05)) == "background"


def test_logo_prominence_large_area_is_large_central():
    assert dh.logo_prominence(Detection(confidence=0.9, x=0.5, y=0.5, w=0.5, h=0.5)) == "large_central"


def test_logo_prominence_small_area_near_corner_is_small_corner():
    detection = Detection(confidence=0.9, x=0.15, y=0.15, w=0.2, h=0.2)
    assert dh.logo_prominence(detection) == "small_corner"


def test_logo_prominence_small_area_centered_is_background_signage():
    detection = Detection(confidence=0.9, x=0.5, y=0.5, w=0.02, h=0.02)
    assert dh.logo_prominence(detection) == "background_signage"


def test_reference_match_label_above_threshold_matches():
    assert dh.reference_match_label(0.95) == "matches_reference"


def test_reference_match_label_below_threshold_cannot_determine():
    assert dh.reference_match_label(0.65) == "cannot_determine"


# ---- focus_quality ----
def test_focus_quality_sharp_for_high_variance_crop(tmp_path):
    path = tmp_path / "sharp.jpg"
    checkerboard = np.indices((50, 50)).sum(axis=0) % 2 * 255
    image = np.stack([checkerboard] * 3, axis=-1).astype(np.uint8)
    cv2.imwrite(str(path), image)

    detection = Detection(confidence=0.9, x=0.5, y=0.5, w=1.0, h=1.0)
    assert dh.focus_quality(str(path), detection) == "sharp"


def test_focus_quality_blurry_for_flat_crop(tmp_path):
    path = tmp_path / "flat.jpg"
    cv2.imwrite(str(path), np.full((50, 50, 3), 128, dtype=np.uint8))

    detection = Detection(confidence=0.9, x=0.5, y=0.5, w=1.0, h=1.0)
    assert dh.focus_quality(str(path), detection) == "blurry"


def test_focus_quality_none_when_frame_missing():
    detection = Detection(confidence=0.9, x=0.5, y=0.5, w=1.0, h=1.0)
    assert dh.focus_quality("/does/not/exist.jpg", detection) is None
