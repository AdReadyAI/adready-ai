from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import IntEnum
from typing import TYPE_CHECKING, ClassVar

from analyzer.frame_sampling.context import FrameContext

if TYPE_CHECKING:
    from analyzer.types import VideoMetadata


class Stage(IntEnum):
    """Probe run order"""

    SCENE = 1
    SAMPLE = 2
    QUALITY = 3
    TEXT = 4
    PRODUCT = 5

@dataclass
class FrameSelection:
    """A lightweight record of a frame a probe wants kept — no pixels."""

    index: int
    timestamp: float
    tags: tuple[str, ...]


@dataclass
class ProbeResult:
    """Base result every probe returns from finalize()."""


@dataclass(frozen=True)
class ProbeSetup:
    """Construction-time inputs handed to every probe via configure()."""

    video_metadata: VideoMetadata
    work_dir: str
    product_imgs_folder_path: str = ""
    logo_imgs_folder_path: str = ""


class Probe(ABC):
    """Uniform, pluggable unit that watches the frame stream."""

    name: ClassVar[str] = ""

    def configure(self, setup: ProbeSetup) -> None:
        """Optional hook: read job inputs / metadata before the loop. No-op by default."""

    @abstractmethod
    def process(self, ctx: FrameContext) -> None:
        """Called once per frame. Update internal state; maybe record a result."""
        ...

    @abstractmethod
    def finalize(self) -> ProbeResult:
        """Called once after the loop. Close out state and return results."""
        ...


_PROBE_REGISTRY: list[tuple[Stage, type[Probe]]] = []


def register_probe(stage: Stage):
    """Register a Probe subclass at a given Stage (lower Stage runs earlier)."""

    def decorator(cls: type[Probe]) -> type[Probe]:
        _PROBE_REGISTRY.append((stage, cls))
        return cls

    return decorator


def get_probe_classes() -> list[type[Probe]]:
    """Registered probe classes, sorted by declared Stage."""
    return [cls for _, cls in sorted(_PROBE_REGISTRY, key=lambda item: item[0])]
