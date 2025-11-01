"""Vision service helpers."""

from .capture import ScreenCapture, ScreenCaptureError
from .confidence import aggregate_confidence, calculate_match_confidence
from .extraction import ElementRecognizer, extract_all_rois, extract_roi
from .gating import compute_overall_confidence, should_gate_element
from .models import ModelManager
from .occlusion import analyze_roi_variance, detect_occlusion, detect_popup_overlay
from .output import VisionOutputBuilder

__all__ = [
  "ScreenCapture",
  "ScreenCaptureError",
  "ModelManager",
  "ElementRecognizer",
  "extract_roi",
  "extract_all_rois",
  "calculate_match_confidence",
  "aggregate_confidence",
  "detect_occlusion",
  "detect_popup_overlay",
  "analyze_roi_variance",
  "VisionOutputBuilder",
  "should_gate_element",
  "compute_overall_confidence"
]
