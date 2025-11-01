"""Occlusion detection functionality."""

import numpy as np
from typing import Tuple


def detect_occlusion(image: np.ndarray, roi: dict) -> Tuple[bool, float]:
    """
    Detect if a region is occluded by analyzing pixel variance and patterns.

    Args:
        image: Full frame image
        roi: ROI definition dict

    Returns:
        Tuple of (is_occluded, occlusion_score)
        occlusion_score: 0.0 (no occlusion) to 1.0 (fully occluded)
    """
    try:
        # Extract the ROI region
        x, y = int(roi['x']), int(roi['y'])
        width, height = int(roi['width']), int(roi['height'])

        # Handle relative coordinates
        if roi.get('relative', False):
            frame_height, frame_width = image.shape[:2]
            x = int(x * frame_width)
            y = int(y * frame_height)
            width = int(width * frame_width)
            height = int(height * frame_height)

        # Ensure bounds are valid
        frame_height, frame_width = image.shape[:2]
        x = max(0, min(x, frame_width - 1))
        y = max(0, min(y, frame_height - 1))
        width = min(width, frame_width - x)
        height = min(height, frame_height - y)

        if width <= 0 or height <= 0:
            return True, 1.0

        roi_region = image[y:y+height, x:x+width]

        # Calculate variance score (low variance = potential occlusion)
        variance_score = analyze_roi_variance(roi_region)

        # Check for popup overlay patterns
        popup_score = 1.0 if detect_popup_overlay(roi_region) else 0.0

        # Combine scores (higher = more occluded)
        occlusion_score = max(variance_score, popup_score)

        # Threshold for occlusion detection
        is_occluded = occlusion_score > 0.5

        return is_occluded, occlusion_score

    except Exception as e:
        # On error, assume occluded
        print(f"Occlusion detection failed: {e}")
        return True, 1.0


def analyze_roi_variance(image: np.ndarray) -> float:
    """
    Analyze pixel variance in ROI to detect uniform regions (potential occlusion).

    Args:
        image: Image region to analyze

    Returns:
        Variance score (0-1, higher = more uniform/possibly occluded)
    """
    try:
        # Convert to grayscale if needed
        if len(image.shape) == 3:
            gray = np.mean(image, axis=2)
        else:
            gray = image

        # Calculate variance
        variance = np.var(gray.astype(np.float32))

        # Normalize variance to 0-1 scale
        # Low variance (< 100) indicates uniform color (likely occlusion)
        # High variance (> 1000) indicates normal texture
        max_variance = 1000.0
        normalized_variance = min(variance / max_variance, 1.0)

        # Invert so low variance = high occlusion score
        occlusion_score = 1.0 - normalized_variance

        return occlusion_score

    except Exception as e:
        print(f"Variance analysis failed: {e}")
        return 1.0


def detect_popup_overlay(image: np.ndarray) -> bool:
    """
    Detect common popup overlay patterns.

    Args:
        image: Image region to analyze

    Returns:
        True if popup overlay detected
    """
    try:
        # Check for semi-transparent appearance (uniform low saturation)
        if len(image.shape) == 3:
            # Convert to HSV to check saturation
            hsv = np.zeros_like(image, dtype=np.float32)
            # Simple HSV conversion approximation
            max_rgb = np.max(image, axis=2)
            min_rgb = np.min(image, axis=2)

            # Saturation = (max - min) / max
            saturation = np.zeros_like(max_rgb, dtype=np.float32)
            mask = max_rgb > 0
            saturation[mask] = (max_rgb[mask] - min_rgb[mask]) / max_rgb[mask]

            avg_saturation = np.mean(saturation)

            # Low average saturation might indicate overlay
            if avg_saturation < 0.1:
                return True

        # Check for uniform color patterns
        if len(image.shape) == 3:
            # Check if all pixels are similar (within tolerance)
            mean_color = np.mean(image, axis=(0, 1))
            std_color = np.std(image, axis=(0, 1))

            # If color variation is very low, might be overlay
            if np.max(std_color) < 10:
                return True

        return False

    except Exception as e:
        print(f"Popup detection failed: {e}")
        return False