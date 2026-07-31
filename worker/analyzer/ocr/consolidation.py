"""Consolidate fixed-rate OCR readings without detector dependencies."""

from dataclasses import dataclass, field

from analyzer.ocr.recognition import RawOcrReading


@dataclass(frozen=True)
class OcrSegment:
    """One coherent recognized text block across periodic source frames."""

    identifier: str
    text: str
    rectangle: tuple[float, float, float, float]
    start_s: float
    end_s: float
    duration_s: float
    confidence: float | None
    representative_frame_index: int
    supporting_frame_indexes: tuple[int, ...]
    source_text_segment_ids: tuple[str, ...] = ()


@dataclass
class _ReadingTrack:
    """Mutable compatible-reading collection internal to consolidation."""

    readings: list[RawOcrReading] = field(default_factory=list)


_MAX_READING_GAP_S = 0.25
_MIN_RECTANGLE_IOU = 0.5


def consolidate_readings(
    readings: tuple[RawOcrReading, ...],
) -> tuple[OcrSegment, ...]:
    """Conservatively merge adjacent fixed-rate readings into OCR Segments."""
    ordered_readings = sorted(
        readings,
        key=lambda reading: (
            reading.timestamp_s,
            reading.rectangle[1],
            reading.rectangle[0],
        ),
    )
    tracks: list[_ReadingTrack] = []

    for reading in ordered_readings:
        compatible = [
            track
            for track in tracks
            if _is_compatible(track.readings[-1], reading)
        ]
        # Ambiguous spatial matches remain separate instead of guessing which
        # simultaneously visible text block should receive the new reading.
        if len(compatible) == 1:
            compatible[0].readings.append(reading)
        else:
            tracks.append(_ReadingTrack(readings=[reading]))

    segments = [_to_segment(track) for track in tracks]
    segments.sort(
        key=lambda segment: (
            segment.start_s,
            segment.rectangle[1],
            segment.rectangle[0],
        )
    )
    return tuple(
        OcrSegment(
            identifier=f"ocr_segment_{position:04d}",
            text=segment.text,
            rectangle=segment.rectangle,
            start_s=segment.start_s,
            end_s=segment.end_s,
            duration_s=segment.duration_s,
            confidence=segment.confidence,
            representative_frame_index=segment.representative_frame_index,
            supporting_frame_indexes=segment.supporting_frame_indexes,
        )
        for position, segment in enumerate(segments, start=1)
    )


def _is_compatible(
    previous: RawOcrReading,
    current: RawOcrReading,
) -> bool:
    """Require exact text, adjacent timing, and conservative spatial overlap."""
    gap_s = current.timestamp_s - previous.timestamp_s
    return (
        current.text == previous.text
        and -1e-9 <= gap_s <= _MAX_READING_GAP_S + 1e-9
        and _intersection_over_union(
            previous.rectangle,
            current.rectangle,
        )
        >= _MIN_RECTANGLE_IOU
    )


def _to_segment(track: _ReadingTrack) -> OcrSegment:
    """Finalize one compatible track with deterministic representative data."""
    first = track.readings[0]
    last = track.readings[-1]
    midpoint_s = first.timestamp_s + (
        last.timestamp_s - first.timestamp_s
    ) / 2
    representative = min(
        track.readings,
        key=lambda reading: (
            abs(reading.timestamp_s - midpoint_s),
            reading.source_frame_index,
        ),
    )
    confidences = [
        reading.confidence
        for reading in track.readings
        if reading.confidence is not None
    ]
    confidence = (
        sum(confidences) / len(confidences)
        if confidences
        else None
    )
    return OcrSegment(
        identifier="",
        text=first.text,
        rectangle=representative.rectangle,
        start_s=first.timestamp_s,
        end_s=last.timestamp_s,
        duration_s=last.timestamp_s - first.timestamp_s,
        confidence=confidence,
        representative_frame_index=representative.source_frame_index,
        # Preserve every contributing source frame once so persistence can
        # later resolve them to stable evaluator-facing frame artifact IDs.
        supporting_frame_indexes=tuple(
            dict.fromkeys(
                reading.source_frame_index
                for reading in track.readings
            )
        ),
    )


def _intersection_over_union(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    """Measure normalized rectangle overlap without image-size dependencies."""
    left_x, left_y, left_width, left_height = left
    right_x, right_y, right_width, right_height = right
    intersection_width = max(
        0.0,
        min(left_x + left_width, right_x + right_width)
        - max(left_x, right_x),
    )
    intersection_height = max(
        0.0,
        min(left_y + left_height, right_y + right_height)
        - max(left_y, right_y),
    )
    intersection = intersection_width * intersection_height
    union = (
        left_width * left_height
        + right_width * right_height
        - intersection
    )
    return intersection / union if union > 0 else 0.0
