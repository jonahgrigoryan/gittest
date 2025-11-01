"""Confidence gating logic."""
from typing import Dict, Any


def should_gate_element(confidence: float, threshold: float) -> bool:
    """
    Check if element should be gated due to low confidence.
    
    Args:
        confidence: Element confidence score
        threshold: Confidence threshold
    
    Returns:
        True if confidence below threshold
    """
    return confidence < threshold


def compute_overall_confidence(elements: Dict[str, Any]) -> float:
    """
    Compute overall confidence from element confidences.
    
    Args:
        elements: Dictionary of element confidences
    
    Returns:
        Weighted average confidence
    """
    weights = {
        "cards": 0.4,
        "stacks": 0.3,
        "pot": 0.1,
        "buttons": 0.1,
        "positions": 0.1
    }
    
    weighted_sum = 0.0
    total_weight = 0.0
    
    for element_type, weight in weights.items():
        if element_type in elements:
            conf = elements[element_type]
            weighted_sum += conf * weight
            total_weight += weight
    
    if total_weight == 0:
        return 0.0
    
    return weighted_sum / total_weight
