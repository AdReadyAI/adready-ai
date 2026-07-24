from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from analyzer.frame_sampling.store import FrameStore


@dataclass
class FrameContext:
    """Per-frame bundle passed to every probe.

    Cheap shared features (gray, small, edges) are computed ONCE per frame so
    no probe recomputes them. The full-res `frame` is kept in hand so a chosen
    frame can be saved at good quality without re-seeking (analyze small, save big).

    `content_val` is the per-frame change score: normalized to [0, 1], higher
    means more change vs the previous frame. `shot_boundary` is True on the
    first frame of a new shot. Both are written by SceneProbe and read by
    AdaptiveSampler.
    """

    index: int
    timestamp: float
    frame: np.ndarray
    gray: np.ndarray
    small: np.ndarray
    edges: np.ndarray

    content_val: float = 0.0
    shot_boundary: bool = False
    store: "FrameStore | None" = None

    def keep(self, tags: tuple[str, ...]) -> None:
        """Write-at-selection: persist this frame via the sampler's store."""
        if self.store is not None:
            self.store.keep(self, tags)
