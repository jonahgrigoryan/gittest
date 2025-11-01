"""Confidence scoring for vision element recognition."""

from typing import List
import numpy as np


def calculate_match_confidence(prediction_probs: np.ndarray) -> float:
    """
    Calculate confidence from softmax probabilities.

    Args:
        prediction_probs: Softmax output probabilities (1D array)

    Returns:
        Confidence score [0, 1]
    """
    if len(prediction_probs) == 0:
        return 0.0

    # Use max probability as confidence
    max_prob = float(np.max(prediction_probs))

    # Optional: Apply calibration
    # For now, return raw max probability
    return max_prob


def aggregate_confidence(confidences: List[float]) -> float:
    """
    Aggregate multiple confidence scores.

    Args:
        confidences: List of confidence scores [0, 1]

    Returns:
        Aggregated confidence using geometric mean
    """
    if not confidences:
        return 0.0

    # Filter out zero confidences to avoid collapsing to zero
    valid_confidences = [c for c in confidences if c > 0]
    if not valid_confidences:
        return 0.0

    # Geometric mean (more conservative than arithmetic mean)
    product = np.prod(valid_confidences)
    geom_mean = float(product ** (1.0 / len(valid_confidences)))

    return geom_mean
