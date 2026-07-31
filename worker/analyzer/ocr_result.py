"""Map consolidated OCR evidence into the evaluator-facing result contract."""

from dataclasses import dataclass

from analyzer.ocr_consolidation import OcrSegment


@dataclass(frozen=True)
class OcrResultSegment:
    """One immutable evaluator-facing OCR Segment."""

    ocr_id: str
    frame_ids: tuple[str, ...]
    start_ms: int
    end_ms: int
    text: str
    on_screen_duration_ms: int
    region_size: float | None
    font_size_px: int | None


def to_ocr_result_segments(
    *,
    segments: tuple[OcrSegment, ...],
    frame_ids_by_index: dict[int, str],
) -> tuple[OcrResultSegment, ...]:
    """Resolve source evidence into stable, evaluator-facing OCR data."""
    results = []
    for segment in segments:
        # Ticket #5 persists the preferred representative artifact only. All
        # supporting source indexes remain on the internal OCR Segment so a
        # later retention policy can expand frame evidence without re-running
        # recognition.
        try:
            representative_frame_id = frame_ids_by_index[
                segment.representative_frame_index
            ]
        except KeyError as error:
            missing_index = error.args[0]
            raise ValueError(
                "OCR Result is missing its representative frame ID for "
                "source frame "
                f"{missing_index}"
            ) from error

        start_ms = _to_milliseconds(segment.start_s)
        end_ms = _to_milliseconds(segment.end_s)
        _, _, width, height = segment.rectangle
        region_size = round(width * height * 100, 6)
        results.append(
            OcrResultSegment(
                ocr_id=segment.identifier,
                frame_ids=(representative_frame_id,),
                start_ms=start_ms,
                end_ms=end_ms,
                text=segment.text,
                on_screen_duration_ms=end_ms - start_ms,
                region_size=region_size,
                # A text-box height is not a defensible font measurement. The
                # field stays absent until an OCR adapter supplies one.
                font_size_px=None,
            )
        )
    return tuple(results)


def _to_milliseconds(timestamp_s: float) -> int:
    """Round a source timestamp to the nearest evaluator millisecond."""
    return int(round(timestamp_s * 1_000))
