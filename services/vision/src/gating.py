"""Confidence gating logic."""

from typing import Dict, Any


def should_gate_element(confidence: float, threshold: float) -> bool:
    """
    Determine if an element should be gated out due to low confidence.

    Args:
        confidence: Element confidence score (0-1)
        threshold: Minimum confidence threshold

    Returns:
        True if element should be gated (confidence too low)
    """
    return confidence < threshold


def compute_overall_confidence(elements: Dict[str, Any]) -> float:
    """
    Compute overall confidence from all detected elements.

    Args:
        elements: Dict of detected elements with confidence scores

    Returns:
        Overall confidence score (0-1)
    """
    if not elements:
        return 0.0

    confidences = []
    weights = {
        'cards': 0.4,   # Cards most important
        'stacks': 0.3,  # Stacks important
        'pot': 0.2,     # Pot moderately important
        'buttons': 0.1  # Button least important
    }

    # Extract confidences from different element types
    if 'cards' in elements and 'confidence' in elements['cards']:
        confidences.append(elements['cards']['confidence'] * weights['cards'])

    if 'stacks' in elements:
        stack_confidences = []
        for stack_data in elements['stacks'].values():
            if 'confidence' in stack_data:
                stack_confidences.append(stack_data['confidence'])
        if stack_confidences:
            avg_stack_conf = sum(stack_confidences) / len(stack_confidences)
            confidences.append(avg_stack_conf * weights['stacks'])

    if 'pot' in elements and 'confidence' in elements['pot']:
        confidences.append(elements['pot']['confidence'] * weights['pot'])

    if 'buttons' in elements and 'confidence' in elements['buttons']:
        confidences.append(elements['buttons']['confidence'] * weights['buttons'])

    if not confidences:
        return 0.0

    # Return weighted average
    return sum(confidences) / len(confidences)