from dataclasses import dataclass, field

import cv2
import numpy as np

from analyzer.frame_sampling.base import Probe, ProbeResult, Stage, register_probe
from analyzer.frame_sampling.context import FrameContext
from config.settings import (
    QUALITY_BLOCKINESS_MAX,
    QUALITY_CONTRAST_MIN,
    QUALITY_EXPOSURE_CLIP_FRAC,
    QUALITY_EXPOSURE_MEAN_MIN,
    QUALITY_FREEZE_MIN_FRAMES,
    QUALITY_NOISE_MAX,
    QUALITY_SHARPNESS_MIN,
    QUALITY_TEMPORAL_FREEZE_MIN,
    QUALITY_TEMPORAL_SPIKE_MAX,
)

_CRUSHED_PIXEL_VAL = 2   # gray values <= this count as clipped-black
_BLOWN_PIXEL_VAL = 253   # gray values >= this count as clipped-white
_BLOCK_SIZE = 8          # JPEG / H.264 macroblock grid


@dataclass
class QualityFlag:
    """One frame the deterministic pass thinks is worth a closer look.

    `scores` carries the raw numbers forward as evidence for a later LLM
    judgment — this probe only decides "worth checking", never "bad".
    """

    index: int
    timestamp: float
    reasons: tuple[str, ...]
    scores: dict[str, float] = field(default_factory=dict)


@dataclass
class QualityProbeResult(ProbeResult):
    flags: list[QualityFlag] = field(default_factory=list)


@register_probe(Stage.QUALITY)
class QualityProbe(Probe):
    """Layer-A deterministic CV metrics (sharpness, exposure, contrast,
    colorfulness, noise, temporal stability) plus flagged-frame collection.
    """

    name = "quality"

    def __init__(self) -> None:
        self._flags: list[QualityFlag] = []
        self._prev_mean: float | None = None
        self._freeze_run = 0

    def process(self, ctx: FrameContext) -> None:
        gray = ctx.gray
        mean = float(gray.mean())
        reasons: list[str] = []
        scores: dict[str, float] = {"mean_luma": mean}

        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        scores["sharpness"] = sharpness
        if sharpness < QUALITY_SHARPNESS_MIN:
            reasons.append("blur")

        crushed_frac = float(np.mean(gray <= _CRUSHED_PIXEL_VAL))
        blown_frac = float(np.mean(gray >= _BLOWN_PIXEL_VAL))
        scores["crushed_frac"] = crushed_frac
        scores["blown_frac"] = blown_frac
        if (
            crushed_frac > QUALITY_EXPOSURE_CLIP_FRAC
            or blown_frac > QUALITY_EXPOSURE_CLIP_FRAC
            or mean < QUALITY_EXPOSURE_MEAN_MIN
        ):
            reasons.append("exposure")

        contrast = float(gray.std())
        scores["contrast"] = contrast
        if contrast < QUALITY_CONTRAST_MIN:
            reasons.append("contrast")

        grain = self._grain(gray)
        blockiness = self._blockiness(gray)
        scores["grain"] = grain
        scores["blockiness"] = blockiness
        if grain > QUALITY_NOISE_MAX:
            reasons.append("noise")
        if blockiness > QUALITY_BLOCKINESS_MAX:
            reasons.append("blockiness")

        temporal_delta = 0.0 if self._prev_mean is None else abs(mean - self._prev_mean)
        scores["temporal_delta"] = temporal_delta
        reasons.extend(self._temporal(ctx, mean, temporal_delta))
        self._prev_mean = mean

        if reasons:
            ctx.keep(("quality", *reasons))
            self._flags.append(
                QualityFlag(
                    index=ctx.index,
                    timestamp=ctx.timestamp,
                    reasons=tuple(reasons),
                    scores=scores,
                )
            )

    def finalize(self) -> QualityProbeResult:
        return QualityProbeResult(flags=self._flags)

    # ---- internals ----
    def _grain(self, gray: np.ndarray) -> float:
        """Noise proxy: residual left after a median blur, which erases
        random noise but preserves real edges better than a Gaussian would.
        """
        denoised = cv2.medianBlur(gray, 3)
        residual = cv2.absdiff(gray, denoised)
        return float(residual.std())

    def _blockiness(self, gray: np.ndarray) -> float:
        """Ratio of gradient energy sitting on the 8x8 codec block grid vs.
        everywhere else. Compression blockiness concentrates edges exactly
        on block boundaries; real image content doesn't.
        """
        col_diff = np.abs(np.diff(gray.astype(np.int16), axis=1))
        row_diff = np.abs(np.diff(gray.astype(np.int16), axis=0))

        col_boundary = col_diff[:, _BLOCK_SIZE - 1 :: _BLOCK_SIZE]
        row_boundary = row_diff[_BLOCK_SIZE - 1 :: _BLOCK_SIZE, :]

        boundary_energy = float(col_boundary.mean()) + float(row_boundary.mean())
        total_energy = float(col_diff.mean()) + float(row_diff.mean())
        if total_energy <= 1e-6:
            return 0.0
        return boundary_energy / total_energy

    def _temporal(self, ctx: FrameContext, mean: float, delta: float) -> list[str]:
        """Frame-to-frame luma delta: hard cut, flicker, freeze, cut-to-black.

        Uses ctx.shot_boundary (written by SceneProbe, which runs before
        Quality in Stage order) to tell a real edit apart from a flicker
        glitch — both produce the same luma spike, only the edit is a
        confirmed shot change.
        """
        if self._prev_mean is None:
            return []

        reasons: list[str] = []

        if delta > QUALITY_TEMPORAL_SPIKE_MAX:
            if mean < QUALITY_EXPOSURE_MEAN_MIN:
                reasons.append("cut_to_black")
            elif ctx.shot_boundary:
                reasons.append("cut")
            else:
                reasons.append("flicker")

        if delta < QUALITY_TEMPORAL_FREEZE_MIN:
            self._freeze_run += 1
            if self._freeze_run == QUALITY_FREEZE_MIN_FRAMES:
                reasons.append("freeze")
        else:
            self._freeze_run = 0

        return reasons
