"""Type definitions for the vision service."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal, Tuple, TypedDict

import numpy as np


class ROI(TypedDict, total=False):
  x: float
  y: float
  width: float
  height: float
  relative: bool


class Resolution(TypedDict):
  width: int
  height: int


ActionButtonROIs = TypedDict(
  "ActionButtonROIs",
  {
    "fold": ROI,
    "check": ROI,
    "call": ROI,
    "raise": ROI,
    "bet": ROI,
    "allIn": ROI
  },
  total=False
)


class WindowPatterns(TypedDict, total=False):
  titleRegex: str
  processName: str
  className: str


class LayoutPack(TypedDict, total=False):
  version: str
  platform: str
  theme: str
  resolution: Resolution
  dpiCalibration: float
  cardROIs: List[ROI]
  stackROIs: Dict[str, ROI]
  potROI: ROI
  buttonROI: ROI
  actionButtonROIs: ActionButtonROIs
  turnIndicatorROI: ROI
  windowPatterns: WindowPatterns
  buttonTemplates: Dict[str, str]


class ButtonInfo(TypedDict, total=False):
  screenCoords: Tuple[int, int]
  isEnabled: bool
  isVisible: bool
  confidence: float
  text: str


@dataclass(slots=True)
class CardRecognition:
  rank: str
  suit: str
  confidence: float
  method: Literal["onnx", "template", "fallback"]


@dataclass(slots=True)
class AmountRecognition:
  amount: float
  confidence: float
  method: Literal["onnx", "ocr"]


@dataclass(slots=True)
class DealerButtonDetection:
  present: bool
  confidence: float


class ExtractedRegion(TypedDict):
  image: np.ndarray
  roi: ROI
  latency: float


class ExtractedElements(TypedDict, total=False):
  cards: List[ExtractedRegion]
  stacks: Dict[str, ExtractedRegion]
  pot: ExtractedRegion
  button: ExtractedRegion
  actionButtons: Dict[str, ExtractedRegion]
  turnIndicator: ExtractedRegion
