"""Confidence score utilities for the vision pipeline."""

from __future__ import annotations

from math import exp, log
from typing import Iterable

import numpy as np


def calculate_match_confidence(prediction_probs: np.ndarray) -> float:
  """Return the maximum probability from a softmax vector."""

  if prediction_probs.size == 0:
    return 0.0

  max_prob = float(np.max(prediction_probs))
  return max(0.0, min(max_prob, 1.0))


def aggregate_confidence(confidences: Iterable[float]) -> float:
  """Aggregate confidences using a bounded geometric mean."""

  values = [max(1e-6, min(float(conf), 1.0)) for conf in confidences if conf is not None]
  if not values:
    return 0.0

  log_sum = sum(log(value) for value in values)
  mean_log = log_sum / len(values)
  score = exp(mean_log)
  return max(0.0, min(score, 1.0))
