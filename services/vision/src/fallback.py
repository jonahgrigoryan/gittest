"""Template matching and OCR fallbacks for the vision system."""

from __future__ import annotations

from typing import Dict, Tuple

import cv2
import numpy as np


def _to_grayscale(image: np.ndarray) -> np.ndarray:
  if image.ndim == 2:
    return image
  return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def match_template(image: np.ndarray, template: np.ndarray) -> float:
  """Return normalized template match confidence in the range [0, 1]."""

  if template.size == 0 or image.size == 0:
    return 0.0

  image_gray = _to_grayscale(image)
  template_gray = _to_grayscale(template)

  try:
    result = cv2.matchTemplate(image_gray, template_gray, cv2.TM_CCOEFF_NORMED)
  except cv2.error:  # pragma: no cover - numeric edge case
    return 0.0

  confidence = float(result.max())
  return max(0.0, min(confidence, 1.0))


def _split_card_key(card_key: str) -> Tuple[str, str]:
  key = card_key.strip().upper()
  if not key:
    return "?", "?"
  suit = key[-1]
  rank = key[:-1] or "?"
  return rank, suit


def recognize_card_template(image: np.ndarray, templates: Dict[str, np.ndarray]) -> Tuple[str, str, float]:
  """Match an image against known card templates."""

  best_rank, best_suit, best_conf = "?", "?", 0.0
  for key, template in templates.items():
    confidence = match_template(image, template)
    if confidence > best_conf:
      best_conf = confidence
      best_rank, best_suit = _split_card_key(key)

  return best_rank, best_suit, best_conf


def recognize_digits_ocr(image: np.ndarray) -> Tuple[str, float]:
  """Recognize digits using OCR when models are unavailable."""

  try:
    import pytesseract  # type: ignore
    from PIL import Image
  except Exception:  # pragma: no cover - optional dependency
    return "", 0.0

  pil_image = Image.fromarray(image)
  try:
    text = pytesseract.image_to_string(
      pil_image,
      config="--psm 7 --oem 1 -c tessedit_char_whitelist=0123456789.,$"
    )
  except pytesseract.TesseractError:  # pragma: no cover - runtime error
    return "", 0.0

  cleaned = text.strip().replace("\n", "")
  cleaned = cleaned.replace(" ", "")
  cleaned = cleaned.replace("O", "0")

  if not cleaned:
    return "", 0.0

  confidence = min(1.0, 0.6 + 0.05 * len(cleaned))
  return cleaned, confidence
