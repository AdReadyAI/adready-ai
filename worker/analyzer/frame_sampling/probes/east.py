"""Run the pinned EAST graph without affecting non-OCR worker features."""

from functools import lru_cache
import hashlib
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from analyzer.frame_sampling.probes.text import TextDetection


EAST_MODEL_PATH = (
    Path(__file__).parents[3]
    / "assets"
    / "models"
    / "frozen_east_text_detection.pb"
)
EAST_MODEL_SHA256 = (
    "9b486f3c3eee77b4c8cc91a83892c37026cca7d29b79bf3b93772ccd2db58454"
)
EAST_INPUT_SIZE = 320
EAST_BATCH_SIZE = 16
EAST_MAX_REGIONS = 50
EAST_CONFIDENCE_THRESHOLD = 0.5
EAST_NMS_THRESHOLD = 0.4
EAST_OUTPUT_LAYERS = (
    "feature_fusion/Conv_7/Sigmoid",
    "feature_fusion/concat_3",
)
EAST_INPUT_MEAN = (123.68, 116.78, 103.94)


class EastUnavailableError(RuntimeError):
    """Report that the OCR-specific EAST dependency cannot be used."""


class EastUnreliableError(RuntimeError):
    """Report EAST output that is too noisy to use as Media Evidence."""


class EastInferenceContractError(RuntimeError):
    """Report malformed EAST input or output without changing shared schemas."""


class _Letterbox:
    """Remember how one source frame was fitted into the EAST input square."""

    def __init__(
        self,
        source_width: int,
        source_height: int,
        resized_width: int,
        resized_height: int,
        pad_left: int,
        pad_top: int,
    ) -> None:
        self.source_width = source_width
        self.source_height = source_height
        self.resized_width = resized_width
        self.resized_height = resized_height
        self.pad_left = pad_left
        self.pad_top = pad_top


def _sha256(path: Path) -> str:
    """Hash the baked graph incrementally so model validation stays memory-bounded."""
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        # The graph is roughly 92 MB, so stream it rather than duplicating the
        # whole model in memory immediately before OpenCV loads it.
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@lru_cache(maxsize=1)
def load_east_network() -> cv2.dnn.Net:
    """Validate and load the one approved EAST graph for this worker process."""
    try:
        actual_sha256 = _sha256(EAST_MODEL_PATH)
    except OSError as error:
        raise EastUnavailableError(
            f"EAST graph is unavailable at {EAST_MODEL_PATH}"
        ) from error

    if actual_sha256 != EAST_MODEL_SHA256:
        raise EastUnavailableError(
            "EAST graph checksum does not match the approved artifact"
        )

    try:
        return cv2.dnn.readNet(str(EAST_MODEL_PATH))
    except (cv2.error, OSError) as error:
        raise EastUnavailableError(
            "OpenCV could not read the approved EAST graph"
        ) from error


class EastTextRegionDetector:
    """Adapt the frozen EAST graph to the narrow TextRegionDetector seam."""

    def __init__(
        self,
        confidence_threshold: float = EAST_CONFIDENCE_THRESHOLD,
        nms_threshold: float = EAST_NMS_THRESHOLD,
    ) -> None:
        self._confidence_threshold = confidence_threshold
        self._nms_threshold = nms_threshold

    def detect_batch(
        self,
        analysis_frames: list[Any],
    ) -> list[list[TextDetection]]:
        """Return one ordered detection collection per source frame."""
        if not analysis_frames:
            return []
        if len(analysis_frames) > EAST_BATCH_SIZE:
            raise EastInferenceContractError(
                f"EAST accepts at most {EAST_BATCH_SIZE} ordered frames"
            )

        letterboxed_frames = []
        transforms = []
        for frame in analysis_frames:
            # Each transform stays aligned with its frame so batched model output
            # can be mapped back without changing TextProbe candidate ordering.
            letterboxed, transform = self._letterbox(frame)
            letterboxed_frames.append(letterboxed)
            transforms.append(transform)

        blob = cv2.dnn.blobFromImages(
            letterboxed_frames,
            scalefactor=1.0,
            size=(EAST_INPUT_SIZE, EAST_INPUT_SIZE),
            mean=EAST_INPUT_MEAN,
            swapRB=True,
            crop=False,
        )
        network = load_east_network()
        try:
            network.setInput(blob)
            scores, geometry = network.forward(EAST_OUTPUT_LAYERS)
        except (cv2.error, ValueError, TypeError) as error:
            raise EastUnavailableError("EAST inference failed") from error

        self._validate_output_cardinality(
            scores,
            geometry,
            len(analysis_frames),
        )

        results = []
        for batch_index, transform in enumerate(transforms):
            # Decode every output plane independently; combining planes here
            # would break the one-result-per-candidate TextProbe contract.
            detections = self._decode_frame(
                scores[batch_index],
                geometry[batch_index],
                transform,
            )
            results.append(detections)

        if len(results) != len(analysis_frames):
            raise EastInferenceContractError(
                "EAST result cardinality does not match the ordered input batch"
            )
        return results

    @staticmethod
    def _letterbox(frame: Any) -> tuple[np.ndarray, _Letterbox]:
        """Aspect-fit one BGR frame into a centered black 320×320 canvas."""
        if not isinstance(frame, np.ndarray) or frame.ndim != 3:
            raise EastInferenceContractError(
                "EAST requires H×W×C NumPy image frames"
            )
        source_height, source_width = frame.shape[:2]
        if source_height <= 0 or source_width <= 0:
            raise EastInferenceContractError(
                "EAST cannot process an empty image frame"
            )

        scale = min(
            EAST_INPUT_SIZE / source_width,
            EAST_INPUT_SIZE / source_height,
        )
        resized_width = min(
            EAST_INPUT_SIZE,
            max(1, round(source_width * scale)),
        )
        resized_height = min(
            EAST_INPUT_SIZE,
            max(1, round(source_height * scale)),
        )
        resized = cv2.resize(
            frame,
            (resized_width, resized_height),
            interpolation=cv2.INTER_LINEAR,
        )
        pad_left = (EAST_INPUT_SIZE - resized_width) // 2
        pad_top = (EAST_INPUT_SIZE - resized_height) // 2
        canvas = np.zeros(
            (EAST_INPUT_SIZE, EAST_INPUT_SIZE, frame.shape[2]),
            dtype=frame.dtype,
        )
        canvas[
            pad_top : pad_top + resized_height,
            pad_left : pad_left + resized_width,
        ] = resized
        return canvas, _Letterbox(
            source_width=source_width,
            source_height=source_height,
            resized_width=resized_width,
            resized_height=resized_height,
            pad_left=pad_left,
            pad_top=pad_top,
        )

    @staticmethod
    def _validate_output_cardinality(
        scores: Any,
        geometry: Any,
        expected: int,
    ) -> None:
        """Reject output tensors that cannot preserve ordered batch identity."""
        if (
            not isinstance(scores, np.ndarray)
            or not isinstance(geometry, np.ndarray)
            or scores.ndim != 4
            or geometry.ndim != 4
            or scores.shape[0] != expected
            or geometry.shape[0] != expected
            or scores.shape[1] != 1
            or geometry.shape[1] != 5
            or scores.shape[2:] != geometry.shape[2:]
        ):
            raise EastInferenceContractError(
                "EAST output cardinality or tensor shape is invalid"
            )

    def _decode_frame(
        self,
        scores: np.ndarray,
        geometry: np.ndarray,
        transform: _Letterbox,
    ) -> list[TextDetection]:
        """Decode, clip, suppress, and normalize one EAST output plane."""
        boxes = []
        confidences = []
        output_height, output_width = scores.shape[1:]
        for y in range(output_height):
            for x in range(output_width):
                confidence = float(scores[0, y, x])
                if confidence < self._confidence_threshold:
                    continue

                # EAST predicts distances from this feature-map location to the
                # four box edges plus its rotation. Convert that representation
                # into an enclosing rectangle in the 320×320 input coordinate.
                top, right, bottom, left, angle = geometry[:, y, x]
                cosine = float(np.cos(angle))
                sine = float(np.sin(angle))
                width = float(left + right)
                height = float(top + bottom)
                offset_x = x * 4.0
                offset_y = y * 4.0
                end_x = offset_x + (cosine * right) + (sine * bottom)
                end_y = offset_y - (sine * right) + (cosine * bottom)
                vertical_x = -sine * height
                vertical_y = -cosine * height
                horizontal_x = -cosine * width
                horizontal_y = sine * width
                corners = (
                    (end_x, end_y),
                    (end_x + vertical_x, end_y + vertical_y),
                    (end_x + horizontal_x, end_y + horizontal_y),
                    (
                        end_x + vertical_x + horizontal_x,
                        end_y + vertical_y + horizontal_y,
                    ),
                )
                # TextDetection owns an axis-aligned rectangle, so enclose all
                # four rotated EAST corners before clipping letterbox padding.
                start_x = float(min(point[0] for point in corners))
                start_y = float(min(point[1] for point in corners))
                bounded_end_x = float(max(point[0] for point in corners))
                bounded_end_y = float(max(point[1] for point in corners))

                clipped = self._clip_to_source_content(
                    start_x,
                    start_y,
                    bounded_end_x,
                    bounded_end_y,
                    transform,
                )
                if clipped is None:
                    continue
                boxes.append(clipped)
                confidences.append(confidence)

        retained_indices = cv2.dnn.NMSBoxes(
            boxes,
            confidences,
            self._confidence_threshold,
            self._nms_threshold,
        )
        retained = [
            int(index)
            for index in np.asarray(retained_indices).reshape(-1)
        ]
        if len(retained) > EAST_MAX_REGIONS:
            raise EastUnreliableError(
                f"EAST retained {len(retained)} regions; "
                f"the reliable maximum is {EAST_MAX_REGIONS}"
            )

        detections = []
        for index in retained:
            x, y, width, height = boxes[index]
            # Dividing by the resized content dimensions maps the clipped
            # letterbox rectangle directly into normalized source coordinates.
            detections.append(
                TextDetection(
                    rectangle=(
                        x / transform.resized_width,
                        y / transform.resized_height,
                        width / transform.resized_width,
                        height / transform.resized_height,
                    ),
                    confidence=confidences[index],
                )
            )
        return detections

    @staticmethod
    def _clip_to_source_content(
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        transform: _Letterbox,
    ) -> tuple[float, float, float, float] | None:
        """Discard padding-only boxes and clip partial boxes to image content."""
        content_left = float(transform.pad_left)
        content_top = float(transform.pad_top)
        content_right = content_left + transform.resized_width
        content_bottom = content_top + transform.resized_height
        clipped_left = max(start_x, content_left)
        clipped_top = max(start_y, content_top)
        clipped_right = min(end_x, content_right)
        clipped_bottom = min(end_y, content_bottom)
        if clipped_right <= clipped_left or clipped_bottom <= clipped_top:
            return None
        return (
            clipped_left - content_left,
            clipped_top - content_top,
            clipped_right - clipped_left,
            clipped_bottom - clipped_top,
        )
