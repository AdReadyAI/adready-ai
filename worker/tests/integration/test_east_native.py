"""Explicit native smoke test for the packaged EAST text-region detector."""

import os

import cv2
import numpy as np
import pytest

from analyzer.text_detection.east import EastTextRegionDetector

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_EAST_NATIVE_SMOKE") != "1",
        reason="set RUN_EAST_NATIVE_SMOKE=1 to exercise the packaged graph",
    ),
]


def _write_synthetic_clip(path):
    """Create a short local clip with a stable, high-contrast text region."""
    width, height = 640, 360
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"MJPG"),
        4.0,
        (width, height),
    )
    if not writer.isOpened():
        pytest.fail("OpenCV could not create the synthetic EAST smoke clip")

    try:
        for _ in range(4):
            # The generated frames are deliberately simple so this smoke test
            # verifies native model packaging rather than video content variety.
            frame = np.full((height, width, 3), 255, dtype=np.uint8)
            cv2.putText(
                frame,
                "LIMITED OFFER",
                (55, 210),
                cv2.FONT_HERSHEY_SIMPLEX,
                2.2,
                (0, 0, 0),
                6,
                cv2.LINE_AA,
            )
            writer.write(frame)
    finally:
        writer.release()


def _read_clip(path):
    """Decode every generated frame to prove the native video path is usable."""
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        pytest.fail("OpenCV could not open the synthetic EAST smoke clip")

    frames = []
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            frames.append(frame)
    finally:
        capture.release()
    return frames


def _overlaps_expected_text(rectangle):
    """Return whether a normalized detection intersects the drawn text area."""
    x, y, width, height = rectangle
    right = x + width
    bottom = y + height
    expected_left = 0.07
    expected_top = 0.35
    expected_right = 0.93
    expected_bottom = 0.65
    return (
        right > expected_left
        and x < expected_right
        and bottom > expected_top
        and y < expected_bottom
    )


def test_packaged_east_detects_expected_synthetic_text_region(tmp_path):
    """The native graph detects text after real clip encoding and decoding."""
    clip_path = tmp_path / "east-smoke.avi"
    _write_synthetic_clip(clip_path)
    frames = _read_clip(clip_path)

    assert len(frames) == 4

    results = EastTextRegionDetector().detect_batch(frames)

    assert len(results) == len(frames)
    assert any(
        _overlaps_expected_text(detection.rectangle)
        for frame_detections in results
        for detection in frame_detections
    )
