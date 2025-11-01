"""Confidence gating helpers for SafeAction logic."""

from __future__ import annotations

from typing import Dict


def should_gate_element(confidence: float, threshold: float) -> bool:
  """Return True when element confidence is below the threshold."""

  return confidence < threshold


def compute_overall_confidence(elements: Dict[str, float]) -> float:
  """Compute weighted confidence prioritizing critical elements."""

  weights = {
    "cards": 0.5,
    "stacks": 0.3,
    "pot": 0.2,
    "buttons": 0.1,
    "positions": 0.1
  }

  weighted_sum = 0.0
  total_weight = 0.0

  for name, confidence in elements.items():
    value = max(0.0, min(confidence, 1.0))
    weight = weights.get(name, 0.05)
    weighted_sum += value * weight
    total_weight += weight

  if total_weight == 0:
    return 0.0

  overall = weighted_sum / total_weight
  return max(0.0, min(overall, 1.0))
