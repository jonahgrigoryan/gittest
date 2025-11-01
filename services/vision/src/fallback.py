"""Template matching fallback for recognition."""
import numpy as np
import cv2
from typing import Tuple, Dict, Optional
import logging

logger = logging.getLogger(__name__)


def match_template(image: np.ndarray, template: np.ndarray) -> float:
    """
    Match template against image using OpenCV.
    
    Args:
        image: Source image
        template: Template image
    
    Returns:
        Match confidence (0-1)
    """
    if image.shape[0] < template.shape[0] or image.shape[1] < template.shape[1]:
        return 0.0
    
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        image_gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        image_gray = image
    
    if len(template.shape) == 3:
        template_gray = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)
    else:
        template_gray = template
    
    # Perform template matching
    result = cv2.matchTemplate(image_gray, template_gray, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, _ = cv2.minMaxLoc(result)
    
    return float(max_val)


def recognize_card_template(image: np.ndarray, templates: Dict[str, np.ndarray]) -> Tuple[str, str, float]:
    """
    Recognize card using template matching.
    
    Args:
        image: Card image
        templates: Dictionary mapping "rank_suit" to template images
    
    Returns:
        (rank, suit, confidence) tuple
    """
    best_match = None
    best_confidence = 0.0
    
    for card_name, template in templates.items():
        confidence = match_template(image, template)
        if confidence > best_confidence:
            best_confidence = confidence
            best_match = card_name
    
    if best_match and best_confidence > 0.7:
        parts = best_match.split("_")
        if len(parts) == 2:
            return (parts[0], parts[1], best_confidence)
    
    return ("?", "?", 0.0)


def recognize_digits_ocr(image: np.ndarray) -> Tuple[str, float]:
    """
    Recognize digits using OCR (pytesseract or simple threshold).
    
    Args:
        image: Digit image
    
    Returns:
        (text, confidence) tuple
    """
    # Simple threshold-based OCR fallback
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    else:
        gray = image
    
    # Threshold
    _, thresh = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)
    
    # Try pytesseract if available
    try:
        import pytesseract
        text = pytesseract.image_to_string(thresh, config="--psm 7 digits")
        text = text.strip().replace(" ", "")
        if text:
            return (text, 0.8)  # Assume reasonable confidence
    except ImportError:
        pass
    
    # Fallback: return 0
    return ("0", 0.5)
