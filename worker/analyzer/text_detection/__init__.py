"""Own text-region detection adapters and TextProbe support storage."""

from importlib import import_module

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


_EXPORT_MODULES = {
    "EastInferenceContractError": "analyzer.text_detection.east",
    "EastTextRegionDetector": "analyzer.text_detection.east",
    "EastUnavailableError": "analyzer.text_detection.east",
    "EastUnreliableError": "analyzer.text_detection.east",
    "TextCandidate": "analyzer.text_detection.candidates",
    "TextCandidateCapacityError": "analyzer.text_detection.candidates",
    "TextCandidateProvenance": "analyzer.text_detection.candidates",
    "TextCandidateStats": "analyzer.text_detection.candidates",
    "TextCandidateStore": "analyzer.text_detection.candidates",
}


def __getattr__(name: str):
    """Load public adapters only when callers cross their specific seam."""
    try:
        module_name = _EXPORT_MODULES[name]
    except KeyError as error:
        raise AttributeError(name) from error

    # Candidate storage is imported while TextProbe itself is initializing.
    # Delaying EAST avoids re-entering that partially initialized probe module.
    value = getattr(import_module(module_name), name)
    globals()[name] = value
    return value
