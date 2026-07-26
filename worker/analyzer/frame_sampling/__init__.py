"""Lazy public exports for the frame-sampling module."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from analyzer.frame_sampling.sampler import FrameSampler

__all__ = ["FrameSampler"]


def __getattr__(name: str):
    """Load the sampler only when a caller requests the public class.

    Importing submodules such as ``frame_sampling.base`` must not start the
    complete sampler/probe graph while shared analyzer types are still loading.
    """
    if name == "FrameSampler":
        from analyzer.frame_sampling.sampler import FrameSampler

        return FrameSampler
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
