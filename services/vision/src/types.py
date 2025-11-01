"""Type definitions for vision service."""

from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass
import numpy as np


@dataclass
class ROI:
    """Region of Interest definition."""

    x: int
    y: int
    width: int
    height: int
    relative: bool = False


@dataclass
class LayoutPack:
    """Layout pack configuration."""

    version: str
    platform: str
    theme: str
    resolution: Dict[str, int]
    dpi_calibration: float
    card_rois: List[ROI]
    stack_rois: Dict[str, ROI]
    pot_roi: ROI
    button_roi: ROI
    action_button_rois: Dict[str, ROI]
    turn_indicator_roi: ROI
    window_patterns: Dict[str, Any]
    button_templates: Optional[Dict[str, str]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LayoutPack":
        """Create LayoutPack from dictionary."""
        return cls(
            version=data["version"],
            platform=data["platform"],
            theme=data["theme"],
            resolution=data["resolution"],
            dpi_calibration=data["dpiCalibration"],
            card_rois=[
                ROI(**{k: v for k, v in roi.items()}) for roi in data["cardROIs"]
            ],
            stack_rois={
                pos: ROI(**{k: v for k, v in roi.items()})
                for pos, roi in data["stackROIs"].items()
            },
            pot_roi=ROI(**data["potROI"]),
            button_roi=ROI(**data["buttonROI"]),
            action_button_rois={
                btn: ROI(**{k: v for k, v in roi.items()})
                for btn, roi in data["actionButtonROIs"].items()
            },
            turn_indicator_roi=ROI(**data["turnIndicatorROI"]),
            window_patterns=data["windowPatterns"],
            button_templates=data.get("buttonTemplates"),
        )


@dataclass
class CardRecognition:
    """Card recognition result."""

    rank: str
    suit: str
    confidence: float
    method: str  # "onnx" or "template"


@dataclass
class AmountRecognition:
    """Stack or pot amount recognition result."""

    amount: float
    confidence: float


@dataclass
class ButtonDetection:
    """Dealer button detection result."""

    present: bool
    confidence: float
