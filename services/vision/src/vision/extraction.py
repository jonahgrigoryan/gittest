"""ROI extraction and element recognition helpers."""

from __future__ import annotations

from dataclasses import asdict
from time import perf_counter
from typing import Dict, Optional

import cv2
import numpy as np

from .fallback import match_template, recognize_card_template, recognize_digits_ocr
from .models import ModelManager
from .types import (
  AmountRecognition,
  CardRecognition,
  DealerButtonDetection,
  ExtractedElements,
  ExtractedRegion,
  LayoutPack,
  ROI
)


def _resolve_roi(frame: np.ndarray, roi: ROI) -> tuple[int, int, int, int]:
  height, width = frame.shape[:2]
  if roi.get("relative"):
    x = int(round(roi["x"] * width))
    y = int(round(roi["y"] * height))
    w = int(round(roi["width"] * width))
    h = int(round(roi["height"] * height))
  else:
    x = int(round(roi["x"]))
    y = int(round(roi["y"]))
    w = int(round(roi["width"]))
    h = int(round(roi["height"]))

  x = max(0, min(x, width))
  y = max(0, min(y, height))
  w = max(1, min(w, width - x))
  h = max(1, min(h, height - y))
  return x, y, w, h


def extract_roi(frame: np.ndarray, roi: ROI) -> np.ndarray:
  """Extract a sub-region from the frame using ROI coordinates."""

  x, y, w, h = _resolve_roi(frame, roi)
  return frame[y : y + h, x : x + w].copy()


def extract_all_rois(frame: np.ndarray, layout: LayoutPack) -> ExtractedElements:
  """Extract all ROIs defined in the layout pack from the frame."""

  extracted: ExtractedElements = {}

  def record(region_name: str, roi: ROI) -> ExtractedRegion:
    start = perf_counter()
    image = extract_roi(frame, roi)
    latency = perf_counter() - start
    return {"image": image, "roi": roi, "latency": latency}

  cards = [record(f"card_{idx}", roi) for idx, roi in enumerate(layout.get("cardROIs", []))]
  if cards:
    extracted["cards"] = cards

  stacks: Dict[str, ExtractedRegion] = {}
  for position, roi in layout.get("stackROIs", {}).items():
    stacks[position] = record(f"stack_{position}", roi)
  if stacks:
    extracted["stacks"] = stacks

  if "potROI" in layout:
    extracted["pot"] = record("pot", layout["potROI"])

  if "buttonROI" in layout:
    extracted["button"] = record("button", layout["buttonROI"])

  if "actionButtonROIs" in layout:
    action_button_regions: Dict[str, ExtractedRegion] = {}
    for name, roi in layout["actionButtonROIs"].items():
      action_button_regions[name] = record(f"action_{name}", roi)
    if action_button_regions:
      extracted["actionButtons"] = action_button_regions

  if "turnIndicatorROI" in layout:
    extracted["turnIndicator"] = record("turn_indicator", layout["turnIndicatorROI"])

  return extracted


class ElementRecognizer:
  """Recognize poker table elements from extracted images."""

  def __init__(
    self,
    model_manager: ModelManager,
    use_fallback: bool = True,
    card_templates: Optional[Dict[str, np.ndarray]] = None,
    dealer_button_template: Optional[np.ndarray] = None
  ) -> None:
    self._manager = model_manager
    self._use_fallback = use_fallback
    self._card_templates = card_templates or {}
    self._dealer_button_template = dealer_button_template

  def recognize_card(self, image: np.ndarray) -> Dict[str, object]:
    rank, rank_conf = self._manager.predict_card_rank(image)
    suit, suit_conf = self._manager.predict_card_suit(image)
    confidence = min(rank_conf, suit_conf)
    method: str = "onnx"

    if self._use_fallback and confidence < 0.8:
      fallback_rank, fallback_suit, fallback_conf = recognize_card_template(image, self._card_templates)
      if fallback_conf > confidence:
        rank, suit, confidence = fallback_rank, fallback_suit, fallback_conf
        method = "template"

    result = CardRecognition(rank=rank, suit=suit, confidence=confidence, method=method)
    return asdict(result)

  def _recognize_amount(self, image: np.ndarray) -> AmountRecognition:
    digits, confidence = self._manager.predict_digits(image)
    method: str = "onnx"

    cleaned = digits.replace(",", "").strip()
    cleaned = cleaned.replace(" ", "")

    if (not cleaned or confidence < 0.7) and self._use_fallback:
      fallback_digits, fallback_conf = recognize_digits_ocr(image)
      if fallback_conf > confidence:
        cleaned = fallback_digits
        confidence = fallback_conf
        method = "ocr"

    amount = 0.0
    try:
      sanitized = cleaned.replace("$", "")
      amount = float(sanitized) if sanitized else 0.0
    except ValueError:
      confidence = 0.0

    return AmountRecognition(amount=amount, confidence=confidence, method=method)

  def recognize_stack(self, image: np.ndarray) -> Dict[str, float]:
    result = self._recognize_amount(image)
    return {"amount": result.amount, "confidence": result.confidence}

  def recognize_pot(self, image: np.ndarray) -> Dict[str, float]:
    result = self._recognize_amount(image)
    return {"amount": result.amount, "confidence": result.confidence}

  def detect_dealer_button(self, image: np.ndarray) -> Dict[str, float]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    normalized = gray.astype(np.float32) / 255.0
    variance = float(np.var(normalized))
    mean = float(np.mean(normalized))
    confidence = min(1.0, variance * 2.5 + mean * 0.2)

    if self._dealer_button_template is not None:
      template_conf = match_template(image, self._dealer_button_template)
      confidence = max(confidence, template_conf)

    present = confidence >= 0.35
    detection = DealerButtonDetection(present=present, confidence=confidence)
    return {"present": detection.present, "confidence": detection.confidence}
