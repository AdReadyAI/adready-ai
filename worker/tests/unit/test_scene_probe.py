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

sys.path.append(
    os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
)

from analyzer.frame_sampling.probes.scene import SceneProbe, Shot, SceneProbeResult
from analyzer.frame_sampling.context import FrameContext


class TestSceneProbe(unittest.TestCase):

    def setUp(self):
        self.mock_setup = MagicMock()
        self.mock_setup.video_metadata.fps = 30.0

        self.probe = SceneProbe()
        self.probe.configure(self.mock_setup)

    def _create_frame_context(self, index: int, timestamp: float, small_frame: np.ndarray) -> FrameContext:
        ctx = MagicMock(spec=FrameContext)
        ctx.index = index
        ctx.timestamp = timestamp
        ctx.small = small_frame
        ctx.content_val = 0.0
        ctx.shot_boundary = False
        return ctx

    def test_scene_probe_initial_frame(self):
        frame0 = self._create_frame_context(0, 0.0, np.zeros((10, 10, 3), dtype=np.uint8))
        
        self.probe.process(frame0)
        
        self.assertEqual(frame0.content_val, 0.0)
        self.assertFalse(frame0.shot_boundary)
        self.assertIsNotNone(self.probe.prev_small)

    def test_scene_probe_no_cut_below_threshold(self):
        f0 = self._create_frame_context(0, 0.0, np.zeros((10, 10, 3), dtype=np.uint8))
        self.probe.process(f0)

        small_modified = np.zeros((10, 10, 3), dtype=np.uint8)
        small_modified[0, 0] = 1
        f1 = self._create_frame_context(1, 0.033, small_modified)
        
        self.probe.process(f1)
        
        self.assertLess(f1.content_val, 1.0)
        self.assertFalse(f1.shot_boundary)

    def test_scene_probe_triggers_cut(self):
        import analyzer.frame_sampling.probes.scene as scene_module
        
        
        original_scale = scene_module.SCENE_CONTENT_SCALE
        original_threshold = scene_module.SCENE_CUT_THRESHOLD
        original_min_frames = scene_module.SCENE_MIN_SHOT_FRAMES
        
        scene_module.SCENE_CONTENT_SCALE = 100.0
        scene_module.SCENE_CUT_THRESHOLD = 0.5
        scene_module.SCENE_MIN_SHOT_FRAMES = 2

        try:
            f0 = self._create_frame_context(0, 0.0, np.zeros((10, 10, 3), dtype=np.uint8))
            self.probe.process(f0)

            f1 = self._create_frame_context(1, 0.033, np.zeros((10, 10, 3), dtype=np.uint8))
            self.probe.process(f1)

            huge_change = np.ones((10, 10, 3), dtype=np.uint8) * 255
            f2 = self._create_frame_context(2, 0.066, huge_change)
            
            self.probe.process(f2)

            self.assertTrue(f2.shot_boundary)
            
            result = self.probe.finalize()
            self.assertIsInstance(result, SceneProbeResult)
            self.assertEqual(len(result.shots), 1)
            self.assertEqual(result.shots[0].start_index, 0)
            self.assertEqual(result.shots[0].end_index, 1)
        finally:
            
            scene_module.SCENE_CONTENT_SCALE = original_scale
            scene_module.SCENE_CUT_THRESHOLD = original_threshold
            scene_module.SCENE_MIN_SHOT_FRAMES = original_min_frames


if __name__ == "__main__":
    unittest.main()