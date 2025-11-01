"""Confidence gating logic for vision system."""

from typing import Dict


def should_gate_element(confidence: float, threshold: float) -> bool:
    """
    Check if element should be gated due to low confidence.

    Args:
        confidence: Element confidence [0, 1]
        threshold: Minimum acceptable confidence

    Returns:
        True if confidence below threshold
    """
    return confidence < threshold


def compute_overall_confidence(elements: Dict[str, float]) -> float:
    """
    Compute weighted average confidence across elements.

    Args:
        elements: Dictionary mapping element name to confidence

    Returns:
        Weighted average confidence
    """
    if not elements:
        return 0.0

    # Define importance weights
    weights = {
        "cards": 3.0,  # Cards are most important
        "stacks": 2.0,  # Stacks are important
        "pot": 1.0,  # Pot is less critical
        "buttons": 1.0,  # Button position is less critical
        "positions": 1.0,  # Position inference
    }

    total_weight = 0.0
    weighted_sum = 0.0

    for name, confidence in elements.items():
        # Extract base element type (e.g., "cards" from "cards_hero")
        base_name = name.split("_")[0]
        weight = weights.get(base_name, 1.0)

        weighted_sum += confidence * weight
        total_weight += weight

    if total_weight == 0:
        return 0.0

    return weighted_sum / total_weight
