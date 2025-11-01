"""Template matching fallback for recognition."""

import cv2
import numpy as np
from typing import Dict, Tuple, Optional


def match_template(image: np.ndarray, template: np.ndarray, method=cv2.TM_CCOEFF_NORMED) -> float:
    """
    Match template against image using OpenCV template matching.

    Args:
        image: Source image (grayscale or color)
        template: Template to match
        method: OpenCV matching method

    Returns:
        Match confidence (0-1, higher is better)
    """
    if len(image.shape) == 3:
        image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    if len(template.shape) == 3:
        template = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)

    try:
        result = cv2.matchTemplate(image, template, method)
        _, max_val, _, _ = cv2.minMaxLoc(result)
        return float(max_val)
    except Exception as e:
        print(f"Template matching failed: {e}")
        return 0.0


def recognize_card_template(image: np.ndarray, templates: Dict[str, np.ndarray]) -> Tuple[str, str, float]:
    """
    Recognize card using template matching against known card templates.

    Args:
        image: Card image to recognize
        templates: Dict mapping 'rank_suit' to template images

    Returns:
        Tuple of (rank, suit, confidence)
    """
    best_match = None
    best_confidence = 0.0

    for card_key, template in templates.items():
        confidence = match_template(image, template)
        if confidence > best_confidence:
            best_confidence = confidence
            best_match = card_key

    if best_match and '_' in best_match:
        rank, suit = best_match.split('_', 1)
        return rank, suit, best_confidence
    else:
        return 'A', 's', 0.0


def recognize_digits_ocr(image: np.ndarray) -> Tuple[str, float]:
    """
    Simple OCR for digit recognition using basic image processing.

    Args:
        image: Image containing digits

    Returns:
        Tuple of (recognized_text, confidence)
    """
    try:
        # Convert to grayscale if needed
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        else:
            gray = image

        # Simple thresholding
        _, thresh = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)

        # Find contours (potential digits)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return '0', 0.0

        # For now, return a placeholder - real OCR would need Tesseract or custom digit recognition
        # This is just a stub implementation
        num_contours = len(contours)
        confidence = min(0.9, num_contours * 0.1)  # Rough confidence based on contour count

        return str(num_contours * 100), confidence  # Placeholder

    except Exception as e:
        print(f"OCR failed: {e}")
        return '0', 0.0