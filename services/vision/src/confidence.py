"""Confidence scoring for vision elements."""
import numpy as np
from typing import List


def calculate_match_confidence(prediction_probs: np.ndarray) -> float:
    """
    Calculate confidence from prediction probabilities.
    
    Args:
        prediction_probs: Softmax probabilities array
    
    Returns:
        Confidence score in [0, 1]
    """
    if len(prediction_probs) == 0:
        return 0.0
    
    # Use max probability as confidence
    max_prob = float(np.max(prediction_probs))
    
    # Apply calibration if needed (for now, direct mapping)
    return max_prob


def aggregate_confidence(confidences: List[float]) -> float:
    """
    Aggregate multiple confidence scores.
    
    Args:
        confidences: List of confidence scores
    
    Returns:
        Aggregated confidence (geometric mean)
    """
    if len(confidences) == 0:
        return 0.0
    
    if len(confidences) == 1:
        return confidences[0]
    
    # Use geometric mean for aggregation
    product = 1.0
    for conf in confidences:
        product *= max(conf, 0.001)  # Avoid zero
    
    return product ** (1.0 / len(confidences))
