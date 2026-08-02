from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import cv2

if TYPE_CHECKING:
    from analyzer.types import Frame


@dataclass
class _Kept:
    """Internal accumulator for a kept frame: metadata only, no pixels."""

    timestamp: float
    path: str
    tags: set[str] = field(default_factory=set)


class FrameStore:
    """Writes selected frames to disk at selection time."""

    def __init__(self, work_dir: str) -> None:
        self._frames_dir = os.path.join(work_dir, "frames")
        self._kept: dict[int, _Kept] = {}

    def keep(self, ctx, tags) -> None:
        """Persist the current frame (write-at-selection)."""
        self.keep_frame(ctx.index, ctx.timestamp, ctx.frame, tags)

    def keep_frame(self, index: int, timestamp: float, frame, tags) -> None:
        """Persist a frame once per index; union tags on repeat keeps."""
        entry = self._kept.get(index)
        if entry is None:
            os.makedirs(self._frames_dir, exist_ok=True)
            path = os.path.join(self._frames_dir, f"{index:06d}.jpg")
            cv2.imwrite(path, frame)
            entry = self._kept[index] = _Kept(timestamp=timestamp, path=path)
        entry.tags.update(tags)

    def manifest(self) -> list[Frame]:
        """Build the tagged Frame manifest, ordered by frame index."""
        from analyzer.types import Frame

        return [
            Frame(index=index, timestamp=entry.timestamp, path=entry.path, tags=tuple(sorted(entry.tags)))
            for index, entry in sorted(self._kept.items())
        ]
