"""ONNX model loading and inference utilities."""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from .confidence import aggregate_confidence, calculate_match_confidence

try:
  import onnxruntime as ort
except Exception:  # pragma: no cover - optional dependency
  ort = None


LOGGER = logging.getLogger(__name__)


MODEL_FILES = {
  "card_rank": "card_rank.onnx",
  "card_suit": "card_suit.onnx",
  "digit": "digit.onnx"
}


RANK_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
SUIT_LABELS = ["h", "d", "c", "s"]
DIGIT_LABELS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "."]


class ModelManager:
  """Manage ONNX models with optional warm-up."""

  def __init__(self, model_dir: str) -> None:
    self._model_dir = model_dir
    self._sessions: Dict[str, Optional["ort.InferenceSession"]] = {name: None for name in MODEL_FILES}

    if ort is None:
      LOGGER.warning("onnxruntime is not available; model inference will use fallbacks")

  def preload_models(self) -> None:
    """Load all known models into memory and warm them up."""

    for name in MODEL_FILES:
      self._get_session(name)

  def _get_session(self, name: str) -> Optional["ort.InferenceSession"]:
    if ort is None:
      return None

    session = self._sessions.get(name)
    if session is not None:
      return session

    filename = MODEL_FILES[name]
    path = os.path.join(self._model_dir, filename)
    if not os.path.exists(path):
      LOGGER.warning("ONNX model missing: %s", path)
      self._sessions[name] = None
      return None

    try:
      providers = ["CPUExecutionProvider"]
      session = ort.InferenceSession(path, providers=providers)
      dummy_input = self._dummy_input(session)
      session.run(None, dummy_input)
      self._sessions[name] = session
      return session
    except Exception as exc:  # pragma: no cover - runtime failure
      LOGGER.error("Failed to load ONNX model %s: %s", path, exc)
      self._sessions[name] = None
      return None

  def _dummy_input(self, session: "ort.InferenceSession") -> Dict[str, np.ndarray]:
    input_meta = session.get_inputs()[0]
    shape = [dim if isinstance(dim, int) else 1 for dim in input_meta.shape]
    tensor = np.zeros(shape, dtype=np.float32)
    return {input_meta.name: tensor}

  def _preprocess(self, image: np.ndarray) -> np.ndarray:
    resized = cv2.resize(image, (64, 64), interpolation=cv2.INTER_AREA)
    if resized.ndim == 2:
      resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2RGB)
    normalized = resized.astype(np.float32) / 255.0
    return normalized.transpose(2, 0, 1)[np.newaxis, :]

  def _run_model(self, session: Optional["ort.InferenceSession"], image: np.ndarray) -> Optional[np.ndarray]:
    if session is None:
      return None
    try:
      input_name = session.get_inputs()[0].name
      tensor = self._preprocess(image)
      outputs = session.run(None, {input_name: tensor})
      return np.asarray(outputs[0])
    except Exception as exc:  # pragma: no cover - runtime failure
      LOGGER.error("Model inference failed: %s", exc)
      return None

  def predict_card_rank(self, image: np.ndarray) -> Tuple[str, float]:
    session = self._get_session("card_rank")
    prediction = self._run_model(session, image)
    if prediction is None:
      return "?", 0.0

    probs = prediction.squeeze()
    if probs.ndim == 0:
      return "?", 0.0

    confidence = calculate_match_confidence(probs)
    index = int(np.argmax(probs))
    rank = RANK_LABELS[index] if 0 <= index < len(RANK_LABELS) else "?"
    return rank, confidence

  def predict_card_suit(self, image: np.ndarray) -> Tuple[str, float]:
    session = self._get_session("card_suit")
    prediction = self._run_model(session, image)
    if prediction is None:
      return "?", 0.0

    probs = prediction.squeeze()
    if probs.ndim == 0:
      return "?", 0.0

    confidence = calculate_match_confidence(probs)
    index = int(np.argmax(probs))
    suit = SUIT_LABELS[index] if 0 <= index < len(SUIT_LABELS) else "?"
    return suit, confidence

  def predict_digits(self, image: np.ndarray) -> Tuple[str, float]:
    session = self._get_session("digit")
    prediction = self._run_model(session, image)
    if prediction is None:
      return "", 0.0

    probs = prediction.squeeze()
    if probs.ndim == 1:
      index = int(np.argmax(probs))
      confidence = calculate_match_confidence(probs)
      return DIGIT_LABELS[index], confidence

    if probs.ndim == 2:
      indices = np.argmax(probs, axis=1)
      confidences: List[float] = []
      tokens: List[str] = []
      for row, idx in zip(probs, indices):
        if 0 <= idx < len(DIGIT_LABELS):
          tokens.append(DIGIT_LABELS[idx])
          confidences.append(float(row[idx]))
      confidence = aggregate_confidence(confidences) if confidences else 0.0
      return "".join(tokens), confidence

    return "", 0.0
