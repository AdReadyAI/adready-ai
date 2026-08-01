import os
import sys
import unittest
from unittest.mock import MagicMock

import numpy as np
import pytest

pytestmark = pytest.mark.unit

os.environ["DATABASE_URL"] = "mock_db"
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from analyzer.frame_sampling.probes.scene import SceneProbe, SceneProbeResult
from analyzer.frame_sampling.context import FrameContext
from config.settings import (
    SCENE_CONTENT_SCALE,
    DYNAMISM_MOSTLY_STATIC_MAX,
    DYNAMISM_MODERATE_MAX,
)


class TestSceneProbe(unittest.TestCase):
    """SceneProbe is PySceneDetect-driven; the detectors and StatsManager are
    mocked so the probe's own logic (normalization, shot building, pacing) is
    exercised in isolation without decoding a real video."""

    def setUp(self):
        setup = MagicMock()
        setup.video_metadata.fps = 30.0

        self.probe = SceneProbe()
        self.probe.configure(setup)

        self.content = MagicMock()
        self.threshold = MagicMock()
        self.stats = MagicMock()

        self.probe.content = self.content
        self.probe.threshold = self.threshold
        self.probe.detectors = [self.content, self.threshold]
        self.probe.stats = self.stats

        for det in (self.content, self.threshold):
            det.process_frame.return_value = []
            det.post_process.return_value = []
        self.stats.metrics_exist.return_value = False

    def _ctx(self, index: int) -> FrameContext:
        ctx = MagicMock(spec=FrameContext)
        ctx.index = index
        ctx.frame = np.zeros((4, 4, 3), dtype=np.uint8)
        return ctx

    def test_process_sets_normalized_content_val(self):
        self.stats.metrics_exist.return_value = True
        self.stats.get_metrics.return_value = [50.0]

        ctx = self._ctx(5)
        self.probe.process(ctx)

        self.assertAlmostEqual(ctx.content_val, 50.0 / SCENE_CONTENT_SCALE)
        self.assertFalse(ctx.shot_boundary)

    def test_content_val_clamped_to_one(self):
        self.stats.metrics_exist.return_value = True
        self.stats.get_metrics.return_value = [500.0]

        ctx = self._ctx(1)
        self.probe.process(ctx)

        self.assertEqual(ctx.content_val, 1.0)

    def test_missing_metrics_default_to_zero(self):
        self.stats.metrics_exist.return_value = False

        ctx = self._ctx(0)
        self.probe.process(ctx)

        self.assertEqual(ctx.content_val, 0.0)

    def test_shot_boundary_when_content_cut_reported(self):
        self.content.process_frame.return_value = [10]

        ctx = self._ctx(10)
        self.probe.process(ctx)

        self.assertTrue(ctx.shot_boundary)
        self.assertIn(10, self.probe.cut_set)

    def test_finalize_builds_shots_pacing_and_fades(self):
        for i in range(30):
            self.content.process_frame.return_value = [15] if i == 15 else []
            self.threshold.process_frame.return_value = [8] if i == 8 else []
            self.probe.process(self._ctx(i))

        result = self.probe.finalize()

        self.assertIsInstance(result, SceneProbeResult)

        # One cut at frame 15 -> two shots: [0..14] and [15..29].
        self.assertEqual(len(result.shots), 2)
        self.assertEqual(result.shots[0].start_index, 0)
        self.assertEqual(result.shots[0].end_index, 14)
        self.assertEqual(result.shots[1].start_index, 15)
        self.assertEqual(result.shots[1].end_index, 29)

        self.assertEqual(result.pacing["shot_count"], 2)
        self.assertAlmostEqual(result.pacing["cuts_per_second"], 1.0)

        # Fade at frame 8 -> 8 / fps seconds.
        self.assertEqual(result.fades, [8 / 30.0])

    def test_finalize_flushes_buffered_cuts_from_post_process(self):
        for i in range(20):
            self.probe.process(self._ctx(i))

        # A cut buffered by the detector and only emitted on post_process.
        self.content.post_process.return_value = [12]

        result = self.probe.finalize()

        self.assertEqual(len(result.shots), 2)
        self.assertEqual(result.shots[0].end_index, 11)
        self.assertEqual(result.shots[1].start_index, 12)

    def test_dynamism_mostly_static_for_near_zero_content(self):
        self.stats.metrics_exist.return_value = True
        # Well below DYNAMISM_MOSTLY_STATIC_MAX after dividing by SCENE_CONTENT_SCALE.
        self.stats.get_metrics.return_value = [0.01 * SCENE_CONTENT_SCALE]

        for i in range(10):
            self.probe.process(self._ctx(i))

        result = self.probe.finalize()

        self.assertEqual(result.dynamism, "mostly_static")

    def test_dynamism_dynamic_for_high_content(self):
        self.stats.metrics_exist.return_value = True
        # Comfortably above DYNAMISM_MODERATE_MAX * SCENE_CONTENT_SCALE, and
        # above SCENE_CONTENT_SCALE itself so content_val clamps to 1.0.
        high_value = (DYNAMISM_MODERATE_MAX * SCENE_CONTENT_SCALE) + SCENE_CONTENT_SCALE
        self.stats.get_metrics.return_value = [high_value]

        for i in range(10):
            self.probe.process(self._ctx(i))

        result = self.probe.finalize()

        self.assertEqual(result.dynamism, "dynamic")

    def test_dynamism_excludes_cut_frame_content_val(self):
        low_value = 0.01 * SCENE_CONTENT_SCALE
        high_value = 10.0 * SCENE_CONTENT_SCALE

        for i in range(10):
            if i == 4:
                self.content.process_frame.return_value = [4]
                self.stats.get_metrics.return_value = [high_value]
            else:
                self.content.process_frame.return_value = []
                self.stats.get_metrics.return_value = [low_value]
            self.stats.metrics_exist.return_value = True
            self.probe.process(self._ctx(i))

        result = self.probe.finalize()

        # The huge value at the cut frame must not be counted, so the result
        # stays based only on the low-content_val non-cut frames.
        self.assertIn(result.dynamism, ("mostly_static", "moderate"))

    def test_dynamism_none_when_all_frames_are_cuts(self):
        self.stats.metrics_exist.return_value = True
        self.stats.get_metrics.return_value = [50.0]

        for i in range(5):
            self.content.process_frame.return_value = [i]
            self.probe.process(self._ctx(i))

        result = self.probe.finalize()

        self.assertIsNone(result.dynamism)


if __name__ == "__main__":
    unittest.main()