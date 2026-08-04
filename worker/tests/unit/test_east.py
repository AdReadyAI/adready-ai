"""Unit tests for isolated loading of the pinned EAST graph."""

import hashlib
import math

import cv2
import numpy as np
import pytest

from analyzer.text_detection import east

pytestmark = pytest.mark.unit


class FakeEastNetwork:
    """Return deterministic EAST tensors while recording the supplied blob."""

    def __init__(self, scores, geometry):
        self.scores = scores
        self.geometry = geometry
        self.blob = None

    def setInput(self, blob):
        """Record the preprocessed batch supplied to the model."""
        self.blob = blob

    def forward(self, output_layers):
        """Return configured score and geometry planes in model order."""
        assert tuple(output_layers) == east.EAST_OUTPUT_LAYERS
        return self.scores, self.geometry


def east_outputs(batch_size):
    """Create empty output planes matching a 320×320 EAST invocation."""
    return (
        np.zeros((batch_size, 1, 80, 80), dtype=np.float32),
        np.zeros((batch_size, 5, 80, 80), dtype=np.float32),
    )


def add_region(
    scores,
    geometry,
    batch_index,
    x,
    y,
    *,
    top,
    right,
    bottom,
    left,
    confidence=0.9,
    angle=0.0,
):
    """Place one EAST region into synthetic output tensors."""
    scores[batch_index, 0, y, x] = confidence
    geometry[batch_index, :, y, x] = (
        top,
        right,
        bottom,
        left,
        angle,
    )


def use_fake_network(monkeypatch, scores, geometry):
    """Install a fake process-local network for one adapter test."""
    network = FakeEastNetwork(scores, geometry)
    monkeypatch.setattr(east, "load_east_network", lambda: network)
    return network


@pytest.fixture(autouse=True)
def clear_east_cache():
    """Prevent one test's process-level model cache from affecting another."""
    east.load_east_network.cache_clear()
    yield
    east.load_east_network.cache_clear()


def test_missing_graph_is_ocr_specific_unavailability(tmp_path, monkeypatch):
    """A missing OCR artifact is reported without introducing startup behavior."""
    missing_path = tmp_path / "missing-east.pb"
    monkeypatch.setattr(east, "EAST_MODEL_PATH", missing_path)

    with pytest.raises(
        east.EastUnavailableError,
        match="EAST graph is unavailable",
    ):
        east.load_east_network()


def test_checksum_mismatch_rejects_unapproved_graph(tmp_path, monkeypatch):
    """A readable file cannot be loaded unless its identity is approved."""
    model_path = tmp_path / "east.pb"
    model_path.write_bytes(b"unexpected graph")
    monkeypatch.setattr(east, "EAST_MODEL_PATH", model_path)
    monkeypatch.setattr(east, "EAST_MODEL_SHA256", "0" * 64)

    with pytest.raises(
        east.EastUnavailableError,
        match="checksum does not match",
    ):
        east.load_east_network()


def test_opencv_rejection_is_ocr_specific_unavailability(tmp_path, monkeypatch):
    """A checksum-valid but unreadable graph remains isolated to the OCR slice."""
    model_bytes = b"checksum-valid but invalid graph"
    model_path = tmp_path / "east.pb"
    model_path.write_bytes(model_bytes)
    monkeypatch.setattr(east, "EAST_MODEL_PATH", model_path)
    monkeypatch.setattr(
        east,
        "EAST_MODEL_SHA256",
        hashlib.sha256(model_bytes).hexdigest(),
    )

    def reject_graph(path):
        """Represent OpenCV failing to deserialize a corrupt graph."""
        raise cv2.error("invalid graph")

    monkeypatch.setattr(east.cv2.dnn, "readNet", reject_graph)

    with pytest.raises(
        east.EastUnavailableError,
        match="OpenCV could not read",
    ):
        east.load_east_network()


def test_successful_graph_load_is_cached_once(tmp_path, monkeypatch):
    """Repeated OCR requests reuse one validated network per worker process."""
    model_bytes = b"approved graph"
    model_path = tmp_path / "east.pb"
    model_path.write_bytes(model_bytes)
    monkeypatch.setattr(east, "EAST_MODEL_PATH", model_path)
    monkeypatch.setattr(
        east,
        "EAST_MODEL_SHA256",
        hashlib.sha256(model_bytes).hexdigest(),
    )
    loaded_network = object()
    loaded_paths = []

    def load_graph(path):
        """Record deserialization attempts while returning a stand-in network."""
        loaded_paths.append(path)
        return loaded_network

    monkeypatch.setattr(east.cv2.dnn, "readNet", load_graph)

    first = east.load_east_network()
    second = east.load_east_network()

    assert first is loaded_network
    assert second is loaded_network
    assert loaded_paths == [str(model_path)]


def test_adapter_letterboxes_and_maps_back_to_source(monkeypatch):
    """A wide source frame retains aspect ratio and normalized coordinates."""
    scores, geometry = east_outputs(batch_size=1)
    add_region(
        scores,
        geometry,
        0,
        20,
        30,
        top=24,
        right=80,
        bottom=24,
        left=48,
    )
    network = use_fake_network(monkeypatch, scores, geometry)
    frame = np.zeros((160, 320, 3), dtype=np.uint8)

    result = east.EastTextRegionDetector().detect_batch([frame])

    assert network.blob.shape == (1, 3, 320, 320)
    assert len(result) == 1
    assert len(result[0]) == 1
    assert result[0][0].rectangle == pytest.approx((0.1, 0.1, 0.4, 0.3))
    assert result[0][0].confidence == pytest.approx(0.9)


def test_adapter_encloses_rotated_region_before_mapping(monkeypatch):
    """A rotated EAST proposal maps through its four true corner coordinates."""
    scores, geometry = east_outputs(batch_size=1)
    add_region(
        scores,
        geometry,
        0,
        20,
        20,
        top=10,
        right=10,
        bottom=10,
        left=10,
        angle=math.pi / 4,
    )
    use_fake_network(monkeypatch, scores, geometry)
    frame = np.zeros((320, 320, 3), dtype=np.uint8)

    result = east.EastTextRegionDetector().detect_batch([frame])

    expected_start = (80 - (10 * math.sqrt(2))) / 320
    expected_size = (20 * math.sqrt(2)) / 320
    assert result[0][0].rectangle == pytest.approx(
        (
            expected_start,
            expected_start,
            expected_size,
            expected_size,
        )
    )


def test_adapter_discards_padding_and_clips_partial_regions(monkeypatch):
    """Padding-only regions disappear while boundary regions stay usable."""
    scores, geometry = east_outputs(batch_size=1)
    add_region(
        scores,
        geometry,
        0,
        10,
        5,
        top=10,
        right=20,
        bottom=10,
        left=20,
    )
    add_region(
        scores,
        geometry,
        0,
        12,
        20,
        top=10,
        right=16,
        bottom=20,
        left=16,
    )
    use_fake_network(monkeypatch, scores, geometry)
    frame = np.zeros((160, 320, 3), dtype=np.uint8)

    result = east.EastTextRegionDetector().detect_batch([frame])

    assert len(result[0]) == 1
    assert result[0][0].rectangle == pytest.approx(
        (0.1, 0.0, 0.1, 0.125)
    )


def test_adapter_preserves_ordered_batch_cardinality(monkeypatch):
    """Each input frame receives its corresponding ordered result collection."""
    scores, geometry = east_outputs(batch_size=2)
    add_region(
        scores,
        geometry,
        0,
        10,
        10,
        top=8,
        right=8,
        bottom=8,
        left=8,
        confidence=0.7,
    )
    add_region(
        scores,
        geometry,
        1,
        20,
        20,
        top=8,
        right=8,
        bottom=8,
        left=8,
        confidence=0.8,
    )
    use_fake_network(monkeypatch, scores, geometry)
    frames = [
        np.zeros((320, 320, 3), dtype=np.uint8),
        np.zeros((320, 320, 3), dtype=np.uint8),
    ]

    result = east.EastTextRegionDetector().detect_batch(frames)

    assert len(result) == 2
    assert result[0][0].confidence == pytest.approx(0.7)
    assert result[1][0].confidence == pytest.approx(0.8)
    assert result[0][0].rectangle[0] < result[1][0].rectangle[0]


def test_adapter_preserves_cardinality_for_full_sixteen_frame_batch(monkeypatch):
    """The largest supported deferred batch returns one collection per frame."""
    scores, geometry = east_outputs(batch_size=east.EAST_BATCH_SIZE)
    for batch_index in range(east.EAST_BATCH_SIZE):
        # Give each batch plane one valid region so an omitted or reordered
        # output cannot hide behind an empty detection collection.
        add_region(
            scores,
            geometry,
            batch_index,
            10 + batch_index,
            10,
            top=2,
            right=2,
            bottom=2,
            left=2,
            confidence=0.6 + (batch_index * 0.01),
        )
    use_fake_network(monkeypatch, scores, geometry)
    frames = [
        np.zeros((320, 320, 3), dtype=np.uint8)
        for _ in range(east.EAST_BATCH_SIZE)
    ]

    result = east.EastTextRegionDetector().detect_batch(frames)

    assert len(result) == east.EAST_BATCH_SIZE
    assert all(len(frame_detections) == 1 for frame_detections in result)
    assert [
        frame_detections[0].confidence for frame_detections in result
    ] == pytest.approx(
        [0.6 + (index * 0.01) for index in range(east.EAST_BATCH_SIZE)]
    )


def test_adapter_rejects_model_output_cardinality_mismatch(monkeypatch):
    """A malformed provider batch cannot be silently paired with candidates."""
    scores, geometry = east_outputs(batch_size=1)
    use_fake_network(monkeypatch, scores, geometry)
    frames = [
        np.zeros((320, 320, 3), dtype=np.uint8),
        np.zeros((320, 320, 3), dtype=np.uint8),
    ]

    with pytest.raises(
        east.EastInferenceContractError,
        match="cardinality or tensor shape",
    ):
        east.EastTextRegionDetector().detect_batch(frames)


def test_adapter_filters_below_threshold_regions(monkeypatch):
    """Low-confidence EAST proposals never cross the detector seam."""
    scores, geometry = east_outputs(batch_size=1)
    add_region(
        scores,
        geometry,
        0,
        10,
        10,
        top=2,
        right=2,
        bottom=2,
        left=2,
        confidence=east.EAST_CONFIDENCE_THRESHOLD - 0.01,
    )
    add_region(
        scores,
        geometry,
        0,
        20,
        20,
        top=2,
        right=2,
        bottom=2,
        left=2,
        confidence=east.EAST_CONFIDENCE_THRESHOLD + 0.01,
    )
    use_fake_network(monkeypatch, scores, geometry)
    frame = np.zeros((320, 320, 3), dtype=np.uint8)

    result = east.EastTextRegionDetector().detect_batch([frame])

    assert len(result[0]) == 1
    assert result[0][0].confidence == pytest.approx(
        east.EAST_CONFIDENCE_THRESHOLD + 0.01
    )


def test_adapter_applies_non_maximum_suppression(monkeypatch):
    """Overlapping model proposals collapse to the strongest retained region."""
    scores, geometry = east_outputs(batch_size=1)
    add_region(
        scores,
        geometry,
        0,
        10,
        10,
        top=10,
        right=10,
        bottom=10,
        left=10,
        confidence=0.9,
    )
    add_region(
        scores,
        geometry,
        0,
        11,
        10,
        top=10,
        right=6,
        bottom=10,
        left=14,
        confidence=0.8,
    )
    use_fake_network(monkeypatch, scores, geometry)
    frame = np.zeros((320, 320, 3), dtype=np.uint8)

    result = east.EastTextRegionDetector().detect_batch([frame])

    assert len(result[0]) == 1
    assert result[0][0].confidence == pytest.approx(0.9)


def test_adapter_marks_excessive_regions_unreliable(monkeypatch):
    """A noisy post-NMS result fails explicitly instead of being truncated."""
    scores, geometry = east_outputs(batch_size=1)
    for index in range(east.EAST_MAX_REGIONS + 1):
        # Spread tiny boxes across the feature map so NMS retains every region.
        x = 2 + (index % 17) * 4
        y = 2 + (index // 17) * 4
        add_region(
            scores,
            geometry,
            0,
            x,
            y,
            top=1,
            right=1,
            bottom=1,
            left=1,
        )
    use_fake_network(monkeypatch, scores, geometry)
    frame = np.zeros((320, 320, 3), dtype=np.uint8)

    with pytest.raises(
        east.EastUnreliableError,
        match="reliable maximum is 50",
    ):
        east.EastTextRegionDetector().detect_batch([frame])


def test_adapter_rejects_batches_larger_than_sixteen():
    """The adapter enforces the batch bound owned by deferred TextProbe."""
    frames = [
        np.zeros((1, 1, 3), dtype=np.uint8)
        for _ in range(east.EAST_BATCH_SIZE + 1)
    ]

    with pytest.raises(
        east.EastInferenceContractError,
        match="at most 16",
    ):
        east.EastTextRegionDetector().detect_batch(frames)
