from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import TYPE_CHECKING

import cv2

import analyzer.frame_sampling.probes
from analyzer.frame_sampling.base import (
    Probe,
    ProbeResult,
    ProbeSetup,
    get_probe_classes,
)
from analyzer.frame_sampling.context import FrameContext
from analyzer.text_detection.east import EastTextRegionDetector
from analyzer.frame_sampling.probes.text import TextProbe
from analyzer.frame_sampling.store import FrameStore
from app.errors import UnrecoverableError
from app.log_utils import phase

if TYPE_CHECKING:
    from analyzer.types import Frame, VideoMetadata

logger = logging.getLogger("worker")


class FrameSampler:
    """Owns the single-pass decode loop that produces the tagged frame pool.

    decoder -> FrameContext -> ordered probe chain -> collectors -> finalize.
    """
    _CANNY_LOW = 50
    _CANNY_HIGH = 150
    _ANALYSIS_LONG_SIDE = 384

    def __init__(
        self,
        video_path: str,
        metadata: VideoMetadata,
        work_dir: str,
        product_image_paths: list[str] | None = None,
        logo_paths: list[str] | None = None,
    ):
        self.video_path = video_path
        self.metadata = metadata
        self.work_dir = work_dir
        self.probes: list[Probe] = self._build_probes()
        self.probe_results: dict[str, ProbeResult] = {}
        self.probe_errors: dict[str, Exception] = {}

        setup = ProbeSetup(
            video_metadata=metadata,
            work_dir=work_dir,
            product_image_paths=product_image_paths or [],
            logo_paths=logo_paths or [],
        )
        for probe in self.probes:
            probe.configure(setup)

    # ---- public entry point ----
    def run(self) -> list[Frame]:
        probe_names = [probe.name for probe in self.probes]
        logger.info(
            "Frame sampling started: %d probes registered: %s",
            len(self.probes), probe_names,
        )

        store = FrameStore(self.work_dir)
        active = list(self.probes)
        with phase(logger, "Frame sampling decode/process loop"):
            for ctx in self._decode():
                ctx.store = store
                for probe in list(active):
                    try:
                        probe.process(ctx)
                    except Exception as exc:
                        logger.exception(
                            "Probe %r failed in process(); disabling it", probe.name
                        )
                        self.probe_errors[probe.name] = exc
                        active.remove(probe)

        self.probe_results = {}
        for probe in self.probes:
            if probe.name in self.probe_errors:
                continue
            finalize_start = time.perf_counter()
            logger.info("Probe %r finalize started", probe.name)
            try:
                self.probe_results[probe.name] = probe.finalize()
            except Exception as exc:
                logger.exception(
                    "Probe %r failed in finalize() after %.2fs",
                    probe.name, time.perf_counter() - finalize_start,
                )
                self.probe_errors[probe.name] = exc
            else:
                logger.info(
                    "Probe %r finalize finished in %.2fs",
                    probe.name, time.perf_counter() - finalize_start,
                )

        frames = store.manifest()
        logger.info(
            "Frame sampling finished: %d frames kept, %d probes succeeded, %d probes failed (%s)",
            len(frames),
            len(self.probe_results),
            len(self.probe_errors),
            list(self.probe_errors),
        )
        return frames

    # ---- internals ----
    def _build_probes(self) -> list[Probe]:
        """Instantiate registered probes in declared order (Scene before Sampler)."""
        probes = []
        for probe_class in get_probe_classes():
            # EAST belongs only to the runtime TextProbe composition. Direct
            # TextProbe construction remains injectable for deterministic tests.
            if probe_class is TextProbe:
                probe = TextProbe(detector=EastTextRegionDetector())
            else:
                probe = probe_class()
            probes.append(probe)
        self._validate_probe_names(probes)
        return probes

    @staticmethod
    def _validate_probe_names(probes: list[Probe]) -> None:
        """Fail fast on empty or duplicate probe names (they key probe_results)."""
        seen: set[str] = set()
        for probe in probes:
            if not probe.name:
                raise ValueError(f"Probe {type(probe).__name__} has an empty name")
            if probe.name in seen:
                raise ValueError(f"Duplicate probe name: {probe.name!r}")
            seen.add(probe.name)

    def _decode(self) -> Iterator[FrameContext]:
        """Yield a FrameContext per sampled frame at the work rate.

        Computes the shared cheap features (gray, small, edges) once per frame
        and keeps the full-res frame in hand for saving.
        """
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            raise UnrecoverableError(f"OpenCV could not open video: {self.video_path}")

        index = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                yield self._build_context(index, frame)
                index += 1
        finally:
            cap.release()
        
    def _build_context(self, index: int, frame) -> FrameContext:
        """Compute the shared cheap features once; keep full-res frame for saving."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small = self._downscale(frame)
        small_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(small_gray, self._CANNY_LOW, self._CANNY_HIGH)
        return FrameContext(
            index=index,
            timestamp=index / self.metadata.fps,
            frame=frame,
            gray=gray,
            small=small,
            edges=edges,
        )

    def _downscale(self, frame):
        h, w = frame.shape[:2]
        scale = self._ANALYSIS_LONG_SIDE / max(h, w)
        if scale >= 1:
            return frame
        return cv2.resize(
            frame,
            (round(w * scale), round(h * scale)),
            interpolation=cv2.INTER_AREA,
        )
