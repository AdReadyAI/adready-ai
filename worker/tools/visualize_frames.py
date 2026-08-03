"""Quick visualization helper for inspecting selected `Frame` objects while debugging.

Usage from a debug console (e.g. paused inside `processor.py` with `artifact` in scope):

    from tools.visualize_frames import plot_frames_by_tag

    # tools/tmp is the only dir bind-mounted back to the host (worker/tools:/app/tools)
    plot_frames_by_tag(artifact.frames, "product", save_path="tools/tmp/product_frames.png")
    plot_frames_by_tag(artifact.frames, "logo", save_path="tools/tmp/logo_frames.png")
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any

THUMB_SIZE = (320, 320)


def plot_frames(frames: Sequence[Any], cols: int = 4, save_path: str | None = None) -> None:
    """Render a grid of frames (objects/dicts with index, timestamp, path, tags)."""
    from PIL import Image
    import matplotlib.pyplot as plt

    print(f"{len(frames)} frames selected")
    if not frames:
        return

    rows = (len(frames) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(4 * cols, 3 * rows), dpi=80, squeeze=False)

    for ax, frame in zip(axes.flat, frames):
        index = frame["index"] if isinstance(frame, dict) else frame.index
        timestamp = frame["timestamp"] if isinstance(frame, dict) else frame.timestamp
        path = frame["path"] if isinstance(frame, dict) else frame.path
        tags = frame["tags"] if isinstance(frame, dict) else frame.tags

        with Image.open(path) as img:
            img.thumbnail(THUMB_SIZE)
            ax.imshow(img)
        ax.set_title(f"idx={index} t={timestamp:.2f}s\n{tags}", fontsize=8)
        ax.axis("off")

    for ax in axes.flat[len(frames):]:
        ax.axis("off")

    plt.tight_layout()
    if save_path:
        os.makedirs(os.path.dirname(save_path) or ".", exist_ok=True)
        fig.savefig(save_path)
        print(f"wrote {save_path}")
    else:
        plt.show()
    plt.close(fig)


def plot_frames_by_tag(frames: Sequence[Any], tag: str, cols: int = 4, save_path: str | None = None) -> None:
    """Filter `frames` to those carrying `tag` and plot them."""
    matching = [f for f in frames if tag in (f["tags"] if isinstance(f, dict) else f.tags)]
    plot_frames(matching, cols=cols, save_path=save_path)
