"""Own OCR candidate routing, recognition, consolidation, and completion."""

from analyzer.ocr.completion import OcrCompletion, OcrCompletionCoordinator
from analyzer.ocr.pipeline import FixedRateOcrAnalysis, FixedRateOcrPipeline
from analyzer.ocr.recognition import (
    DeterministicOcrAdapter,
    DeterministicOcrObservation,
    OcrAdapter,
    RawOcrReading,
)
from analyzer.ocr.routing import (
    OcrCandidateMode,
    OcrRoutingDecision,
)

__all__ = [
    "DeterministicOcrAdapter",
    "DeterministicOcrObservation",
    "FixedRateOcrAnalysis",
    "FixedRateOcrPipeline",
    "OcrAdapter",
    "OcrCandidateMode",
    "OcrCompletion",
    "OcrCompletionCoordinator",
    "OcrRoutingDecision",
    "RawOcrReading",
]
