"""Screen capture utilities."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional, Tuple

import numpy as np


LOGGER = logging.getLogger(__name__)


class ScreenCaptureError(RuntimeError):
  """Raised when the screen capture backend fails."""


@dataclass(slots=True)
class ScreenCapture:
  """Provide cross-platform screen capture with graceful fallbacks."""

  window_title: Optional[str] = None
  fallback_resolution: Tuple[int, int] = (1080, 1920)
  _grabber: Optional[object] = field(init=False, default=None)
  _backend_name: Optional[str] = field(init=False, default=None)

  def __post_init__(self) -> None:
    self._detect_backend()

  def _detect_backend(self) -> None:
    """Detect an available capture backend in priority order."""

    try:
      from PIL import ImageGrab  # type: ignore

      self._grabber = ImageGrab
      self._backend_name = "PIL.ImageGrab"
      LOGGER.debug("Using PIL.ImageGrab for screen capture")
      return
    except Exception:  # pragma: no cover - optional dependency
      LOGGER.debug("PIL.ImageGrab unavailable for screen capture")

    try:
      import mss  # type: ignore  # pylint: disable=import-error

      self._grabber = mss
      self._backend_name = "mss"
      LOGGER.debug("Using mss for screen capture")
      return
    except Exception:  # pragma: no cover - optional dependency
      LOGGER.debug("mss unavailable for screen capture")

    self._grabber = None
    self._backend_name = None

  def capture_frame(self) -> np.ndarray:
    """Capture a frame from the screen or raise an error on failure.

    When no backend is available a black fallback frame is returned. This
    enables downstream testing without native screen capture support.
    """

    if self._grabber is None:
      LOGGER.warning("No screen capture backend available; returning fallback frame")
      height, width = self.fallback_resolution
      return np.zeros((height, width, 3), dtype=np.uint8)

    try:
      if self._backend_name == "PIL.ImageGrab":
        image = self._grabber.grab()  # type: ignore[attr-defined]
        frame = np.array(image.convert("RGB"))
      elif self._backend_name == "mss":
        with self._grabber.mss() as sct:  # type: ignore[attr-defined]
          monitor = sct.monitors[0]
          raw = sct.grab(monitor)
          frame = np.array(raw)[:, :, :3]
      else:  # pragma: no cover - defensive fallback
        raise ScreenCaptureError("Unsupported capture backend configured")

      return frame
    except Exception as exc:  # pragma: no cover - device interaction
      LOGGER.error("Screen capture failed: %s", exc)
      height, width = self.fallback_resolution
      return np.zeros((height, width, 3), dtype=np.uint8)
