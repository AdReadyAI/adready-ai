"""Measure visual sameness between OCR-owned source-frame candidates."""

import cv2
import numpy as np

from analyzer.ocr.candidates import OcrCandidate
from analyzer.frame_sampling.probes.text import TextSegment
from analyzer.ocr.routing import OcrCandidateSimilarity


def compare_candidate_visuals(
    candidate: OcrCandidate,
    representative: OcrCandidate,
    text_segment: TextSegment,
) -> OcrCandidateSimilarity:
    """Compare the tracked region while leaving unavailable geometry unknown."""
    candidate_image = cv2.imread(candidate.path, cv2.IMREAD_GRAYSCALE)
    representative_image = cv2.imread(
        representative.path,
        cv2.IMREAD_GRAYSCALE,
    )
    candidate_crop = _crop_normalized(candidate_image, text_segment.rectangle)
    representative_crop = _crop_normalized(
        representative_image,
        text_segment.rectangle,
    )
    if candidate_crop is None or representative_crop is None:
        # Missing source pixels are uncertain evidence, so routing will retain
        # the hosted OCR call instead of treating the read failure as sameness.
        return OcrCandidateSimilarity(
            spatial_overlap=None,
            geometry_similarity=None,
            perceptual_hash_similarity=None,
            edge_signature_similarity=None,
        )

    return OcrCandidateSimilarity(
        # Aggregate Text Segments do not expose independent per-frame boxes.
        # Detailed geometry evidence remains unknown until that data exists.
        spatial_overlap=None,
        geometry_similarity=None,
        perceptual_hash_similarity=_perceptual_hash_similarity(
            candidate_crop,
            representative_crop,
        ),
        edge_signature_similarity=_edge_signature_similarity(
            candidate_crop,
            representative_crop,
        ),
    )


def _crop_normalized(
    image: np.ndarray | None,
    rectangle: tuple[float, float, float, float],
) -> np.ndarray | None:
    """Return a clamped non-empty crop from normalized source coordinates."""
    if image is None or image.size == 0:
        return None

    x, y, width, height = rectangle
    image_height, image_width = image.shape[:2]
    left = max(0, min(image_width, round(x * image_width)))
    top = max(0, min(image_height, round(y * image_height)))
    right = max(0, min(image_width, round((x + width) * image_width)))
    bottom = max(0, min(image_height, round((y + height) * image_height)))
    if right <= left or bottom <= top:
        return None
    return image[top:bottom, left:right]


def _perceptual_hash_similarity(
    left: np.ndarray,
    right: np.ndarray,
) -> float:
    """Measure normalized equality between compact average hashes."""
    left_hash = _average_hash(left)
    right_hash = _average_hash(right)
    differing_bits = np.count_nonzero(left_hash != right_hash)
    return 1.0 - (differing_bits / left_hash.size)


def _average_hash(image: np.ndarray) -> np.ndarray:
    """Encode broad luminance structure as a stable 64-bit boolean grid."""
    resized = cv2.resize(image, (8, 8), interpolation=cv2.INTER_AREA)
    return resized >= resized.mean()


def _edge_signature_similarity(
    left: np.ndarray,
    right: np.ndarray,
) -> float:
    """Measure normalized agreement between resized Canny edge masks."""
    comparison_size = (64, 64)
    left_resized = cv2.resize(left, comparison_size, interpolation=cv2.INTER_AREA)
    right_resized = cv2.resize(
        right,
        comparison_size,
        interpolation=cv2.INTER_AREA,
    )
    left_edges = cv2.Canny(left_resized, 100, 200) > 0
    right_edges = cv2.Canny(right_resized, 100, 200) > 0
    differing_pixels = np.count_nonzero(left_edges != right_edges)
    return 1.0 - (differing_pixels / left_edges.size)
