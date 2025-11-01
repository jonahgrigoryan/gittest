"""Occlusion detection for ROIs."""
import numpy as np
from typing import Tuple
import cv2
import logging

logger = logging.getLogger(__name__)


def detect_occlusion(image: np.ndarray, roi: dict) -> Tuple[bool, float]:
    """
    Detect if ROI is occluded.
    
    Args:
        image: Image containing ROI
        roi: ROI dictionary (for reference, image is already cropped)
    
    Returns:
        (is_occluded, occlusion_score) tuple
    """
    variance_score = analyze_roi_variance(image)
    popup_detected = detect_popup_overlay(image)
    
    # Low variance indicates potential occlusion
    # Typical poker UI has high variance (cards, text, etc.)
    variance_threshold = 500.0  # Adjust based on empirical data
    
    is_occluded = variance_score < variance_threshold or popup_detected
    
    # Occlusion score: 0 = no occlusion, 1 = fully occluded
    occlusion_score = 0.0
    if variance_score < variance_threshold:
        occlusion_score = 1.0 - (variance_score / variance_threshold)
    if popup_detected:
        occlusion_score = max(occlusion_score, 0.5)
    
    return (is_occluded, occlusion_score)


def analyze_roi_variance(image: np.ndarray) -> float:
    """
    Analyze pixel variance in ROI.
    
    Args:
        image: ROI image
    
    Returns:
        Variance score (higher = more varied = less occluded)
    """
    if len(image.shape) == 3:
        # Convert to grayscale
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        gray = image
    
    # Calculate standard deviation
    std = np.std(gray.astype(np.float32))
    
    # Return variance (std^2) scaled for interpretability
    return float(std * std)


def detect_popup_overlay(image: np.ndarray) -> bool:
    """
    Detect popup overlay patterns.
    
    Args:
        image: ROI image
    
    Returns:
        True if popup detected
    """
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        gray = image
    
    # Check for uniform colors (popups often have solid backgrounds)
    std = np.std(gray.astype(np.float32))
    
    # Very low variance suggests uniform overlay
    if std < 10.0:
        return True
    
    # Check for semi-transparent overlay patterns
    # Look for edge patterns typical of popup windows
    edges = cv2.Canny(gray, 50, 150)
    edge_density = np.sum(edges > 0) / (edges.shape[0] * edges.shape[1])
    
    # Popups often have rectangular borders
    # Low edge density with uniform interior suggests popup
    if edge_density < 0.01 and std < 30.0:
        return True
    
    return False
