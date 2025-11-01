"""Fallback recognition methods using template matching and OCR."""

from typing import Dict, Tuple
import numpy as np
import cv2


def match_template(image: np.ndarray, template: np.ndarray) -> float:
    """
    Match template against image using OpenCV.

    Args:
        image: Target image
        template: Template to match

    Returns:
        Match confidence [0, 1]
    """
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        image_gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        image_gray = image

    if len(template.shape) == 3:
        template_gray = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)
    else:
        template_gray = template

    # Match template
    result = cv2.matchTemplate(image_gray, template_gray, cv2.TM_CCOEFF_NORMED)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

    return float(max_val)


def recognize_card_template(
    image: np.ndarray, templates: Dict[str, np.ndarray]
) -> Tuple[str, str, float]:
    """
    Recognize card using template matching.

    Args:
        image: Card ROI image
        templates: Dictionary of template images (key: "rank_suit", e.g., "A_h")

    Returns:
        Tuple of (rank, suit, confidence)
    """
    best_match = 0.0
    best_rank = "A"
    best_suit = "h"

    for key, template in templates.items():
        confidence = match_template(image, template)
        if confidence > best_match:
            best_match = confidence
            parts = key.split("_")
            if len(parts) == 2:
                best_rank, best_suit = parts

    return best_rank, best_suit, best_match


def recognize_digits_ocr(image: np.ndarray) -> Tuple[str, float]:
    """
    Recognize digits using simple OCR.

    Args:
        image: Stack/pot ROI image

    Returns:
        Tuple of (text, confidence)
    """
    # Placeholder implementation
    # In production, would use pytesseract or custom OCR
    try:
        # Simple threshold-based approach
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        else:
            gray = image

        # Threshold
        _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY)

        # Count white pixels as confidence proxy
        white_ratio = np.sum(binary > 0) / binary.size
        confidence = min(white_ratio * 2, 1.0)

        # Placeholder: return fixed value
        return "1000", confidence
    except Exception:
        return "0", 0.0
