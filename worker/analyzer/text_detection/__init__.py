"""Own text-region detection adapters and TextProbe support storage."""

from analyzer.text_detection.candidates import (
    TextCandidate,
    TextCandidateCapacityError,
    TextCandidateProvenance,
    TextCandidateStats,
    TextCandidateStore,
)
from analyzer.text_detection.east import (
    EastInferenceContractError,
    EastTextRegionDetector,
    EastUnavailableError,
    EastUnreliableError,
)

__all__ = [
    "EastInferenceContractError",
    "EastTextRegionDetector",
    "EastUnavailableError",
    "EastUnreliableError",
    "TextCandidate",
    "TextCandidateCapacityError",
    "TextCandidateProvenance",
    "TextCandidateStats",
    "TextCandidateStore",
]
