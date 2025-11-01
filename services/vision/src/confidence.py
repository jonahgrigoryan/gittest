"""Confidence scoring and calculation."""

import numpy as np
from typing import List, Dict, Any


def calculate_match_confidence(prediction_probs: np.ndarray) -> float:
    """
    Calculate confidence from softmax prediction probabilities.

    Args:
        prediction_probs: Array of class probabilities

    Returns:
        Confidence score (0-1)
    """
    if len(prediction_probs) == 0:
        return 0.0

    # Use the maximum probability as confidence
    return float(np.max(prediction_probs))


def aggregate_confidence(confidences: List[float]) -> float:
    """
    Aggregate multiple confidence scores.

    Args:
        confidences: List of individual confidence scores

    Returns:
        Aggregated confidence score
    """
    if not confidences:
        return 0.0

    # Use geometric mean for aggregation
    # (product of confidences)^(1/n)
    product = np.prod(confidences)
    return float(product ** (1.0 / len(confidences)))


def calculate_overall_confidence(elements: Dict[str, Any]) -> float:
    """
    Calculate overall confidence from all detected elements.

    Args:
        elements: Dict of element detections with confidence scores

    Returns:
        Overall confidence score
    """
    confidences = []

    # Weight different element types
    weights = {
        'card': 0.4,    # Cards are most important
        'stack': 0.3,   # Stacks are important
        'pot': 0.2,     # Pot is moderately important
        'button': 0.1   # Button is least important
    }

    for element_key, element_data in elements.items():
        if 'confidence' in element_data:
            confidence = element_data['confidence']
            # Apply weight based on element type
            if element_key.startswith('card'):
                weight = weights['card']
            elif element_key.startswith('stack'):
                weight = weights['stack']
            elif element_key.startswith('pot'):
                weight = weights['pot']
            elif element_key.startswith('button'):
                weight = weights['button']
            else:
                weight = 0.1  # Default low weight

            confidences.append(confidence * weight)

    if not confidences:
        return 0.0

    # Return weighted average
    return float(np.mean(confidences))