"""Occlusion detection heuristics for vision elements."""

from __future__ import annotations

import numpy as np


VARIANCE_THRESHOLD = 12.0


def analyze_roi_variance(image: np.ndarray) -> float:
  """Compute the standard deviation of pixel intensities."""

  if image.size == 0:
    return 0.0

  if image.ndim == 3:
    gray = np.mean(image, axis=2)
  else:
    gray = image

  variance = float(np.std(gray))
  return variance


def detect_popup_overlay(image: np.ndarray) -> bool:
  """Detect common overlay properties such as transparency and uniform tint."""

  if image.size == 0:
    return False

  if image.ndim == 3 and image.shape[2] == 4:
    alpha = image[:, :, 3] / 255.0
    if float(np.mean(alpha)) < 0.6:
      return True

  if image.ndim == 3:
    gray = np.mean(image[:, :, :3], axis=2)
  else:
    gray = image

  near_white = np.mean(gray > 240)
  near_black = np.mean(gray < 15)
  return bool(near_white > 0.8 or near_black > 0.8)


def detect_occlusion(image: np.ndarray, roi: dict) -> tuple[bool, float]:
  """Detect whether a region appears occluded and return a score."""

  variance = analyze_roi_variance(image)
  normalized = 1.0 - min(1.0, variance / VARIANCE_THRESHOLD)
  normalized = max(0.0, min(normalized, 1.0))

  overlay = detect_popup_overlay(image)
  is_occluded = overlay or variance < VARIANCE_THRESHOLD * 0.5
  return is_occluded, normalized
