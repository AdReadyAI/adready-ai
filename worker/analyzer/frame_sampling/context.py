from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from analyzer.frame_sampling.store import FrameStore


@dataclass
class FrameContext:
    """Per-frame bundle passed to every probe."""

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
