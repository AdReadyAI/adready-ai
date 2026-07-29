"""Public-behavior tests for detector-only TextProbe Media Evidence."""

import numpy as np
import pytest

from analyzer.frame_sampling.base import ProbeSetup
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.probes.text import TextDetection, TextProbe
from analyzer.frame_sampling.store import FrameStore
from analyzer.types import VideoMetadata

pytestmark = pytest.mark.unit


class FakeTextRegionDetector:
    """Deterministic substitute for the external model adapter seam."""

    def __init__(self, detections_by_frame):
        self.detections_by_frame = detections_by_frame

    def detect_batch(self, analysis_frames):
        """Return the configured spatial evidence for every candidate frame."""
        return self.detections_by_frame[: len(analysis_frames)]


def test_configured_probe_uses_and_cleans_complete_periodic_path(tmp_path):
    """Quiet visual content still receives fixed-rate OCR candidate coverage."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    frame_store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.zeros((100, 200), dtype=np.uint8),
            store=frame_store,
        )
        for index, timestamp in [(0, 0.0), (1, 0.25)]
    ]
    detection = TextDetection(
        rectangle=(0.1, 0.2, 0.4, 0.1),
        confidence=0.9,
        visual_signature="stable-region",
    )
    probe = TextProbe(
        detector=FakeTextRegionDetector([[detection], [detection]])
    )
    probe.configure(
        ProbeSetup(
            video_metadata=VideoMetadata(
                duration_s=0.5,
                fps=4.0,
                width=200,
                height=100,
                size_bytes=100,
            ),
            work_dir=str(tmp_path),
        )
    )

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    assert result.text_segments[0].end_s == 0.25
    assert result.text_segments[0].candidate_sources == (
        "edge_change",
        "periodic",
    )
    assert result.candidate_stats.accepted_count == 2
    assert result.candidate_stats.dropped_count == 0
    assert list(tmp_path.glob("ocr-candidates-*")) == []


def test_provider_failure_reuses_periodic_candidates_then_cleans_up(tmp_path):
    """Fallback retains reserved JPEGs without decoding the Ad Creative again."""
    class FailingTextRegionDetector:
        """Deterministic provider failure at the detector adapter seam."""

        def detect_batch(self, analysis_frames):
            raise RuntimeError("provider unavailable")

    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    frame_store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.zeros((100, 200), dtype=np.uint8),
            store=frame_store,
        )
        for index, timestamp in [(0, 0.0), (1, 0.25)]
    ]
    probe = TextProbe(detector=FailingTextRegionDetector())
    probe.configure(
        ProbeSetup(
            video_metadata=VideoMetadata(
                duration_s=0.5,
                fps=4.0,
                width=200,
                height=100,
                size_bytes=100,
            ),
            work_dir=str(tmp_path),
        )
    )

    for context in contexts:
        probe.process(context)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        probe.finalize()

    manifest = frame_store.manifest()
    assert [frame.timestamp for frame in manifest] == [0.0, 0.25]
    assert all(frame.tags == ("periodic",) for frame in manifest)
    assert list(tmp_path.glob("ocr-candidates-*")) == []


def test_unexpected_collection_failure_cleans_existing_candidates(tmp_path):
    """A corrupt later frame cannot leak earlier OCR candidate files."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    frame_store = FrameStore(str(tmp_path))
    probe = TextProbe(detector=FakeTextRegionDetector([]))
    probe.configure(
        ProbeSetup(
            video_metadata=VideoMetadata(
                duration_s=0.5,
                fps=4.0,
                width=200,
                height=100,
                size_bytes=100,
            ),
            work_dir=str(tmp_path),
        )
    )
    first_context = FrameContext(
        index=0,
        timestamp=0.0,
        frame=frame,
        gray=frame[:, :, 0],
        small=frame,
        edges=np.zeros((100, 200), dtype=np.uint8),
        store=frame_store,
    )
    corrupt_context = FrameContext(
        index=1,
        timestamp=0.25,
        frame=frame,
        gray=frame[:, :, 0],
        small=frame,
        edges=None,
        store=frame_store,
    )

    probe.process(first_context)
    assert len(list(tmp_path.glob("ocr-candidates-*"))) == 1

    with pytest.raises(AttributeError):
        probe.process(corrupt_context)

    assert list(tmp_path.glob("ocr-candidates-*")) == []


def test_first_frame_text_produces_segment_and_representative(tmp_path):
    """Text visible at the beginning must produce traceable Media Evidence."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    context = FrameContext(
        index=0,
        timestamp=0.0,
        frame=frame,
        gray=frame[:, :, 0],
        small=frame,
        edges=np.zeros((100, 200), dtype=np.uint8),
        store=FrameStore(str(tmp_path)),
    )
    detector = FakeTextRegionDetector(
        [
            [
                TextDetection(
                    rectangle=(0.1, 0.2, 0.4, 0.1),
                    confidence=0.9,
                )
            ]
        ]
    )
    probe = TextProbe(detector=detector)

    probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    segment = result.text_segments[0]
    assert segment.start_s == 0.0
    assert segment.end_s == 0.0
    assert segment.duration_s == 0.0
    assert segment.rectangle == (0.1, 0.2, 0.4, 0.1)
    assert segment.detector_confidence == 0.9
    assert segment.representative_frame_index == 0
    assert segment.candidate_sources == ("edge_change",)

    manifest = context.store.manifest()
    assert len(manifest) == 1
    assert manifest[0].timestamp == 0.0
    assert manifest[0].tags == ("text",)


def test_falling_edge_change_closes_open_text_segment(tmp_path):
    """Text disappearance must be observable through an absolute edge change."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=0,
            timestamp=0.0,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.full((100, 200), 255, dtype=np.uint8),
            store=store,
        ),
        FrameContext(
            index=1,
            timestamp=0.5,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.zeros((100, 200), dtype=np.uint8),
            store=store,
        ),
    ]
    detector = FakeTextRegionDetector(
        [
            [TextDetection(rectangle=(0.1, 0.2, 0.4, 0.1), confidence=0.9)],
            [],
        ]
    )
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    assert result.text_segments[0].start_s == 0.0
    assert result.text_segments[0].end_s == 0.5
    assert result.text_segments[0].duration_s == 0.5


def test_repeated_region_extends_one_segment_and_selects_stronger_frame(tmp_path):
    """Persistent text remains one segment with its strongest representative."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=0,
            timestamp=0.0,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.full((100, 200), 255, dtype=np.uint8),
            store=store,
        ),
        FrameContext(
            index=1,
            timestamp=0.5,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.zeros((100, 200), dtype=np.uint8),
            store=store,
        ),
    ]
    detector = FakeTextRegionDetector(
        [
            [TextDetection(rectangle=(0.1, 0.2, 0.4, 0.1), confidence=0.7)],
            [TextDetection(rectangle=(0.1, 0.2, 0.4, 0.1), confidence=0.9)],
        ]
    )
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    segment = result.text_segments[0]
    assert segment.start_s == 0.0
    assert segment.end_s == 0.5
    assert segment.duration_s == 0.5
    assert segment.representative_frame_index == 1
    assert segment.detector_confidence == 0.9


def test_visually_stable_moving_region_remains_one_segment(tmp_path):
    """Motion continuity must not depend exclusively on rectangle overlap."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=0,
            timestamp=0.0,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.full((100, 200), 255, dtype=np.uint8),
            store=store,
        ),
        FrameContext(
            index=1,
            timestamp=0.5,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.zeros((100, 200), dtype=np.uint8),
            store=store,
        ),
    ]
    detector = FakeTextRegionDetector(
        [
            [
                TextDetection(
                    rectangle=(0.1, 0.2, 0.1, 0.1),
                    confidence=0.8,
                    visual_signature="stable-region",
                )
            ],
            [
                TextDetection(
                    rectangle=(0.3, 0.2, 0.1, 0.1),
                    confidence=0.8,
                    visual_signature="stable-region",
                )
            ],
        ]
    )
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    assert result.text_segments[0].start_s == 0.0
    assert result.text_segments[0].end_s == 0.5


def test_one_missing_observation_within_tolerance_retains_uncertainty(tmp_path):
    """A brief detector miss must not fragment otherwise continuous text."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=edges,
            store=store,
        )
        for index, timestamp, edges in [
            (0, 0.0, np.full((100, 200), 255, dtype=np.uint8)),
            (1, 0.25, np.zeros((100, 200), dtype=np.uint8)),
            (2, 0.5, np.full((100, 200), 255, dtype=np.uint8)),
        ]
    ]
    detection = TextDetection(
        rectangle=(0.1, 0.2, 0.4, 0.1),
        confidence=0.9,
        visual_signature="stable-region",
    )
    detector = FakeTextRegionDetector([[detection], [], [detection]])
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    segment = result.text_segments[0]
    assert segment.start_s == 0.0
    assert segment.end_s == 0.5
    assert segment.missed_observations == 1
    assert segment.timing_uncertainty_s == 0.25


def test_region_returning_after_missing_tolerance_opens_new_segment(tmp_path):
    """Text returning after 500 ms must not revive stale tracking evidence."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=edges,
            store=store,
        )
        for index, timestamp, edges in [
            (0, 0.0, np.full((100, 200), 255, dtype=np.uint8)),
            (1, 0.25, np.zeros((100, 200), dtype=np.uint8)),
            (2, 0.75, np.full((100, 200), 255, dtype=np.uint8)),
        ]
    ]
    detection = TextDetection(
        rectangle=(0.1, 0.2, 0.4, 0.1),
        confidence=0.9,
        visual_signature="stable-region",
    )
    detector = FakeTextRegionDetector([[detection], [], [detection]])
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 2
    assert result.text_segments[0].start_s == 0.0
    assert result.text_segments[0].end_s == 0.25
    assert result.text_segments[1].start_s == 0.75
    assert result.text_segments[1].end_s == 0.75


def test_missing_region_is_observed_while_another_region_remains(tmp_path):
    """Each unmatched region must retain absence evidence independently."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=edges,
            store=store,
        )
        for index, timestamp, edges in [
            (0, 0.0, np.full((100, 200), 255, dtype=np.uint8)),
            (1, 0.25, np.zeros((100, 200), dtype=np.uint8)),
            (2, 0.75, np.full((100, 200), 255, dtype=np.uint8)),
        ]
    ]
    region_a = TextDetection(
        rectangle=(0.1, 0.2, 0.2, 0.1),
        confidence=0.9,
        visual_signature="region-a",
    )
    region_b = TextDetection(
        rectangle=(0.6, 0.2, 0.2, 0.1),
        confidence=0.8,
        visual_signature="region-b",
    )
    detector = FakeTextRegionDetector(
        [
            [region_a, region_b],
            [region_a],
            [region_a],
        ]
    )
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    segments_by_rectangle = {
        segment.rectangle: segment for segment in result.text_segments
    }
    missing_region = segments_by_rectangle[region_b.rectangle]
    assert [segment.rectangle for segment in result.text_segments] == [
        region_a.rectangle,
        region_b.rectangle,
    ]
    assert missing_region.end_s == 0.25
    assert missing_region.missed_observations == 1
    assert missing_region.timing_uncertainty_s == 0.25


def test_scene_cut_selects_frame_resets_gate_and_retains_provenance(tmp_path):
    """Scene evidence must select once without fabricating later edge changes."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=np.zeros((100, 200), dtype=np.uint8),
            shot_boundary=shot_boundary,
            store=store,
        )
        for index, timestamp, shot_boundary in [
            (0, 0.0, False),
            (1, 0.25, True),
            (2, 0.5, False),
        ]
    ]
    detection = TextDetection(
        rectangle=(0.1, 0.2, 0.4, 0.1),
        confidence=0.9,
        visual_signature="stable-region",
    )
    detector = FakeTextRegionDetector([[detection], [detection]])
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    assert result.text_segments[0].end_s == 0.25
    assert result.text_segments[0].candidate_sources == (
        "edge_change",
        "scene_cut",
    )


def test_equal_quality_observations_select_temporal_midpoint(tmp_path):
    """Equivalent detections should represent the segment near its midpoint."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=edges,
            store=store,
        )
        for index, timestamp, edges in [
            (0, 0.0, np.full((100, 200), 255, dtype=np.uint8)),
            (1, 0.25, np.zeros((100, 200), dtype=np.uint8)),
            (2, 0.5, np.full((100, 200), 255, dtype=np.uint8)),
        ]
    ]
    detection = TextDetection(
        rectangle=(0.1, 0.2, 0.4, 0.1),
        confidence=0.9,
        visual_signature="stable-region",
    )
    detector = FakeTextRegionDetector([[detection], [detection], [detection]])
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 1
    assert result.text_segments[0].representative_frame_index == 1


def test_ambiguous_identical_regions_remain_separate_segments(tmp_path):
    """Ambiguous visual matches must preserve simultaneous spatial evidence."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    store = FrameStore(str(tmp_path))
    contexts = [
        FrameContext(
            index=index,
            timestamp=timestamp,
            frame=frame,
            gray=frame[:, :, 0],
            small=frame,
            edges=edges,
            store=store,
        )
        for index, timestamp, edges in [
            (0, 0.0, np.full((100, 200), 255, dtype=np.uint8)),
            (1, 0.25, np.zeros((100, 200), dtype=np.uint8)),
        ]
    ]
    left = TextDetection(
        rectangle=(0.1, 0.2, 0.2, 0.1),
        confidence=0.9,
        visual_signature="identical-looking",
    )
    right = TextDetection(
        rectangle=(0.3, 0.2, 0.2, 0.1),
        confidence=0.9,
        visual_signature="identical-looking",
    )
    ambiguous = TextDetection(
        rectangle=(0.2, 0.2, 0.2, 0.1),
        confidence=0.9,
        visual_signature="identical-looking",
    )
    detector = FakeTextRegionDetector([[left, right], [ambiguous]])
    probe = TextProbe(detector=detector)

    for context in contexts:
        probe.process(context)
    result = probe.finalize()

    assert len(result.text_segments) == 3
    assert {segment.rectangle for segment in result.text_segments} == {
        left.rectangle,
        right.rectangle,
        ambiguous.rectangle,
    }


def test_text_segments_receive_deterministic_run_scoped_identifiers(tmp_path):
    """Stable identifiers let later OCR consolidation retain Text Segment provenance."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    context = FrameContext(
        index=0,
        timestamp=0.0,
        frame=frame,
        gray=frame[:, :, 0],
        small=frame,
        edges=np.zeros((100, 200), dtype=np.uint8),
        store=FrameStore(str(tmp_path)),
    )
    detector = FakeTextRegionDetector(
        [
            [
                TextDetection(
                    rectangle=(0.1, 0.2, 0.2, 0.1),
                    confidence=0.9,
                ),
                TextDetection(
                    rectangle=(0.6, 0.2, 0.2, 0.1),
                    confidence=0.8,
                ),
            ]
        ]
    )

    first_result = TextProbe(detector=detector)
    first_result.process(context)
    segments = first_result.finalize().text_segments

    # Identifiers are deterministic within one run and restart for a new run,
    # allowing durable OCR records to link back without using visual hashes.
    assert [segment.identifier for segment in segments] == [
        "text_segment_0001",
        "text_segment_0002",
    ]
