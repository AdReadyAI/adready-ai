from abc import abstractmethod
from dataclasses import dataclass, field
from typing import Any

import cv2
import imagehash
import numpy as np
import torch
from PIL import Image

from analyzer.frame_sampling.base import ProbeResult, ProbeSetup
from analyzer.frame_sampling.context import FrameContext
from analyzer.frame_sampling.deferred import Candidate, DeferredModelProbe
from config.models import get_mobileclip

_PHASH_DISTANCE_THRESHOLD = 8

# TODO: THESE WILL BE REDEFINED AFTER TESTING
_ORB_DISTANCE_THRESHOLD = 50  # max Hamming distance to count a keypoint match as "good"
_ORB_MATCH_THRESHOLD = 15  # good matches needed to confirm presence via ORB alone
_CLIP_SIMILARITY_THRESHOLD = 0.28  # cosine similarity needed to confirm presence via CLIP


@dataclass
class _ModelInput:
    """Lightweight, model-ready payload for one gated candidate frame."""

    clip_tensor: torch.Tensor
    gray: np.ndarray


@dataclass
class PresenceInterval:
    """A confirmed presence span, traceable back to the exact frames."""

    start_index: int
    start_s: float
    end_index: int
    end_s: float


@dataclass
class ReferenceMatchResult(ProbeResult):
    """Presence intervals where the reference was confirmed."""

    presence_intervals: list[PresenceInterval] = field(default_factory=list)


class ReferenceMatchProbe(DeferredModelProbe):
    """Cost-cascaded reference-image presence: cheap pHash-novelty gate ->
    MobileCLIP similarity / ORB match -> tag confirmed frames and track
    presence intervals.

    The expensive model runs on collected candidates (deferred batch), not
    inline on every frame.

    Subclasses only need to supply which reference image paths to match
    against (product images vs. logo images) and the tag/name to emit.
    """

    def __init__(self) -> None:
        super().__init__()
        self._last_hash: imagehash.ImageHash | None = None
        self._clip_model = None
        self._clip_preprocess = None
        self._ref_clip_embeds: torch.Tensor | None = None
        self._ref_labels: list[str] = []

        self._orb = cv2.ORB_create()
        self._bf = cv2.BFMatcher(cv2.NORM_HAMMING)
        self._ref_orb_descriptors: list[Any] = []

        self._intervals: list[PresenceInterval] = []
        self._open_start_index: int | None = None
        self._open_start: float | None = None
        self._open_end_index: int | None = None
        self._open_end: float | None = None

    @abstractmethod
    def _reference_paths(self, setup: ProbeSetup) -> list[str]:
        """Local paths of the reference images to match frames against."""
        ...

    def configure(self, setup: ProbeSetup) -> None:
        references = [(path, self.name) for path in self._reference_paths(setup)]
        if not references:
            return

        self._clip_model, self._clip_preprocess = get_mobileclip()

        embeds = []
        for path, label in references:
            image = Image.open(path).convert("RGB")

            tensor = self._clip_preprocess(image).unsqueeze(0)
            with torch.no_grad():
                embed = self._clip_model.encode_image(tensor)
                embed /= embed.norm(dim=-1, keepdim=True)
            embeds.append(embed)
            self._ref_labels.append(label)

            bgr = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            _, descriptors = self._orb.detectAndCompute(gray, None)
            self._ref_orb_descriptors.append(descriptors)

        self._ref_clip_embeds = torch.cat(embeds, dim=0)

    def _gate(self, ctx: FrameContext) -> bool:
        if self._clip_preprocess is None:
            # No reference images configured for this run; nothing to match.
            return False

        rgb = ctx.small[:, :, ::-1]
        current_hash = imagehash.phash(Image.fromarray(rgb))

        if self._last_hash is None or (current_hash - self._last_hash) >= _PHASH_DISTANCE_THRESHOLD:
            self._last_hash = current_hash
            return True
        return False

    def _candidate(self, ctx: FrameContext) -> Any:
        rgb = ctx.small[:, :, ::-1]
        clip_tensor = self._clip_preprocess(Image.fromarray(rgb))
        gray = cv2.cvtColor(ctx.small, cv2.COLOR_BGR2GRAY)
        return _ModelInput(clip_tensor=clip_tensor, gray=gray)

    def _orb_match_count(self, gray: np.ndarray) -> int:
        """Best good-match count for this frame against any reference image."""
        if not self._ref_orb_descriptors:
            return 0

        _, descriptors = self._orb.detectAndCompute(gray, None)
        if descriptors is None:
            return 0

        best = 0
        for ref_descriptors in self._ref_orb_descriptors:
            if ref_descriptors is None:
                continue
            matches = self._bf.match(ref_descriptors, descriptors)
            good = [m for m in matches if m.distance < _ORB_DISTANCE_THRESHOLD]
            best = max(best, len(good))
        return best

    def _batch_infer(self, model_inputs: list[Any]) -> list[Any]:
        results: list[bool] = [False] * len(model_inputs)

        needs_clip: list[int] = []
        for i, item in enumerate(model_inputs):
            if self._orb_match_count(item.gray) >= _ORB_MATCH_THRESHOLD:
                results[i] = True
            else:
                needs_clip.append(i)

        if needs_clip and self._ref_clip_embeds is not None:
            tensors = torch.stack([model_inputs[i].clip_tensor for i in needs_clip])
            with torch.no_grad():
                embeds = self._clip_model.encode_image(tensors)
                embeds /= embeds.norm(dim=-1, keepdim=True)
            similarities = (embeds @ self._ref_clip_embeds.T).max(dim=1).values

            for index, similarity in zip(needs_clip, similarities.tolist()):
                results[index] = similarity >= _CLIP_SIMILARITY_THRESHOLD

        return results

    def _emit(self, candidate: Candidate, result: Any) -> None:
        if result:
            self._keep(candidate, (self.name,))
            if self._open_start_index is None:
                self._open_start_index = candidate.index
                self._open_start = candidate.timestamp
            self._open_end_index = candidate.index
            self._open_end = candidate.timestamp
            return

        if self._open_start_index is not None:
            self._intervals.append(
                PresenceInterval(
                    start_index=self._open_start_index,
                    start_s=self._open_start,
                    end_index=self._open_end_index,
                    end_s=self._open_end,
                )
            )
            self._open_start_index = None
            self._open_start = None
            self._open_end_index = None
            self._open_end = None

    def _result(self) -> ProbeResult:
        if self._open_start_index is not None:
            self._intervals.append(
                PresenceInterval(
                    start_index=self._open_start_index,
                    start_s=self._open_start,
                    end_index=self._open_end_index,
                    end_s=self._open_end,
                )
            )
            self._open_start_index = None
            self._open_start = None
            self._open_end_index = None
            self._open_end = None
        return ReferenceMatchResult(presence_intervals=list(self._intervals))
