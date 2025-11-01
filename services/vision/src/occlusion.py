"""Occlusion detection for ROI regions."""

from typing import Tuple
import numpy as np
import cv2

from .types import ROI


def detect_occlusion(image: np.ndarray, roi: ROI) -> Tuple[bool, float]:
    """
    Detect if ROI is occluded by popup or overlay.

    Args:
        image: Extracted ROI image
        roi: ROI definition (for metadata)

    Returns:
        Tuple of (is_occluded, occlusion_score)
        - is_occluded: True if likely occluded
        - occlusion_score: Percentage occluded [0, 1]
    """
    variance_score = analyze_roi_variance(image)

    # Low variance indicates uniform color (likely occlusion)
    # Threshold tuned for poker tables
    is_occluded = variance_score < 10.0

    # Normalize to [0, 1] range
    occlusion_score = max(0.0, min(1.0, (20.0 - variance_score) / 20.0))

    return is_occluded, occlusion_score


def analyze_roi_variance(image: np.ndarray) -> float:
    """
    Compute pixel variance in ROI.

    Args:
        image: ROI image

    Returns:
        Variance score (higher = more variation = less likely occluded)
    """
    if len(image.shape) == 3:
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        gray = image

    # Calculate standard deviation
    std_dev = float(np.std(gray))

    return std_dev


def detect_popup_overlay(image: np.ndarray) -> bool:
    """
    Detect semi-transparent popup overlays.

    Args:
        image: ROI or full frame image

    Returns:
        True if popup detected
    """
    # Check for common popup patterns:
    # 1. Uniform dark overlay
    # 2. Very bright regions (modal dialogs)

    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        gray = image

    mean_brightness = np.mean(gray)

    # Very dark (overlay) or very bright (dialog)
    is_dark_overlay = mean_brightness < 30
    is_bright_dialog = mean_brightness > 225

    return is_dark_overlay or is_bright_dialog
