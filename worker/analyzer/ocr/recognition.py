"""Provider-neutral OCR recognition models and deterministic test adapter."""

from dataclasses import dataclass
from typing import Protocol

from analyzer.ocr.candidates import OcrCandidate


@dataclass(frozen=True)
class RawOcrReading:
    """One normalized frame-level OCR observation with source provenance."""

    source_frame_index: int
    timestamp_s: float
    text: str
    rectangle: tuple[float, float, float, float]
    confidence: float | None


class OcrAdapter(Protocol):
    """Replaceable recognition boundary shared by fake and hosted adapters."""

    def recognize(
        self,
        candidate: OcrCandidate,
    ) -> tuple[RawOcrReading, ...]:
        """Return compact normalized readings for one complete source frame."""
        ...


@dataclass(frozen=True)
class DeterministicOcrObservation:
    """Pixel-space fake observation used by deterministic acceptance tests."""

    text: str
    rectangle_pixels: tuple[int, int, int, int]
    confidence: float | None


class DeterministicOcrAdapter:
    """Normalize configured fake observations without external calls."""

    def __init__(
        self,
        observations_by_frame: dict[
            int,
            tuple[DeterministicOcrObservation, ...],
        ],
    ) -> None:
        self._observations_by_frame = observations_by_frame

    def recognize(
        self,
        candidate: OcrCandidate,
    ) -> tuple[RawOcrReading, ...]:
        """Return deterministic readings in configured provider order."""
        encoded_width, encoded_height = candidate.encoded_dimensions
        if encoded_width <= 0 or encoded_height <= 0:
            raise ValueError(
                "OCR candidate dimensions must be positive"
            )

        readings = []
        for observation in self._observations_by_frame.get(
            candidate.index,
            (),
        ):
            # Provider rectangles are normalized immediately so downstream
            # consolidation never depends on an encoded image resolution.
            x, y, width, height = observation.rectangle_pixels
            readings.append(
                RawOcrReading(
                    source_frame_index=candidate.index,
                    timestamp_s=candidate.timestamp,
                    text=observation.text,
                    rectangle=(
                        x / encoded_width,
                        y / encoded_height,
                        width / encoded_width,
                        height / encoded_height,
                    ),
                    confidence=observation.confidence,
                )
            )
        return tuple(readings)
