"""ROI extraction and element recognition."""

import time
from typing import Dict, Optional, Tuple
import numpy as np
import cv2

from .types import ROI, LayoutPack, CardRecognition, AmountRecognition, ButtonDetection


def extract_roi(frame: np.ndarray, roi: ROI, window_bounds: Optional[Tuple[int, int, int, int]] = None) -> np.ndarray:
    """
    Extract region of interest from frame.

    Args:
        frame: Full frame image (H, W, 3)
        roi: ROI definition
        window_bounds: Optional (x, y, width, height) of window for relative coords

    Returns:
        Cropped image

    Raises:
        ValueError: If ROI is invalid or out of bounds
    """
    height, width = frame.shape[:2]

    # Handle relative coordinates
    if roi.relative:
        if window_bounds is None:
            # Use full frame as window
            x = int(roi.x * width)
            y = int(roi.y * height)
            w = int(roi.width * width)
            h = int(roi.height * height)
        else:
            wx, wy, ww, wh = window_bounds
            x = wx + int(roi.x * ww)
            y = wy + int(roi.y * wh)
            w = int(roi.width * ww)
            h = int(roi.height * wh)
    else:
        x, y, w, h = roi.x, roi.y, roi.width, roi.height

    # Validate bounds
    if x < 0 or y < 0 or x + w > width or y + h > height:
        raise ValueError(
            f"ROI out of bounds: ({x}, {y}, {w}, {h}) for frame size ({width}, {height})"
        )

    # Extract region
    return frame[y : y + h, x : x + w].copy()


def extract_all_rois(
    frame: np.ndarray, layout: LayoutPack
) -> Tuple[Dict[str, np.ndarray], Dict[str, float]]:
    """
    Extract all ROIs defined in layout pack.

    Args:
        frame: Full frame image
        layout: Layout pack configuration

    Returns:
        Tuple of (extracted_images, extraction_times)
        - extracted_images: Dictionary mapping element name to cropped image
        - extraction_times: Dictionary mapping element name to extraction time (ms)
    """
    images: Dict[str, np.ndarray] = {}
    times: Dict[str, float] = {}

    # Extract card ROIs
    for idx, roi in enumerate(layout.card_rois):
        start = time.perf_counter()
        try:
            images[f"card_{idx}"] = extract_roi(frame, roi)
            times[f"card_{idx}"] = (time.perf_counter() - start) * 1000
        except ValueError as e:
            print(f"Warning: Failed to extract card_{idx}: {e}")

    # Extract stack ROIs
    for pos, roi in layout.stack_rois.items():
        start = time.perf_counter()
        try:
            images[f"stack_{pos}"] = extract_roi(frame, roi)
            times[f"stack_{pos}"] = (time.perf_counter() - start) * 1000
        except ValueError as e:
            print(f"Warning: Failed to extract stack_{pos}: {e}")

    # Extract pot ROI
    start = time.perf_counter()
    try:
        images["pot"] = extract_roi(frame, layout.pot_roi)
        times["pot"] = (time.perf_counter() - start) * 1000
    except ValueError as e:
        print(f"Warning: Failed to extract pot: {e}")

    # Extract button ROI
    start = time.perf_counter()
    try:
        images["button"] = extract_roi(frame, layout.button_roi)
        times["button"] = (time.perf_counter() - start) * 1000
    except ValueError as e:
        print(f"Warning: Failed to extract button: {e}")

    # Extract action button ROIs
    for btn, roi in layout.action_button_rois.items():
        start = time.perf_counter()
        try:
            images[f"action_{btn}"] = extract_roi(frame, roi)
            times[f"action_{btn}"] = (time.perf_counter() - start) * 1000
        except ValueError as e:
            print(f"Warning: Failed to extract action_{btn}: {e}")

    # Extract turn indicator ROI
    start = time.perf_counter()
    try:
        images["turn_indicator"] = extract_roi(frame, layout.turn_indicator_roi)
        times["turn_indicator"] = (time.perf_counter() - start) * 1000
    except ValueError as e:
        print(f"Warning: Failed to extract turn_indicator: {e}")

    return images, times


class ElementRecognizer:
    """Recognize poker elements from extracted ROI images."""

    def __init__(self, model_manager, use_fallback: bool = True):
        """
        Initialize element recognizer.

        Args:
            model_manager: ModelManager instance for ONNX inference
            use_fallback: Whether to use template matching fallback
        """
        self.model_manager = model_manager
        self.use_fallback = use_fallback

    def recognize_card(self, image: np.ndarray) -> CardRecognition:
        """
        Recognize card from image.

        Args:
            image: Card ROI image

        Returns:
            CardRecognition with rank, suit, confidence, and method
        """
        # Try ONNX models first
        rank, rank_conf = self.model_manager.predict_card_rank(image)
        suit, suit_conf = self.model_manager.predict_card_suit(image)

        confidence = min(rank_conf, suit_conf)

        # Fall back to template matching if confidence is low
        if confidence < 0.8 and self.use_fallback:
            # Template matching fallback would go here
            # For now, use ONNX results
            pass

        return CardRecognition(
            rank=rank, suit=suit, confidence=confidence, method="onnx"
        )

    def recognize_stack(self, image: np.ndarray) -> AmountRecognition:
        """
        Recognize stack amount from image.

        Args:
            image: Stack ROI image

        Returns:
            AmountRecognition with amount and confidence
        """
        digits_str, confidence = self.model_manager.predict_digits(image)

        # Parse as float
        try:
            # Remove commas and parse
            amount = float(digits_str.replace(",", ""))
        except ValueError:
            amount = 0.0
            confidence = 0.0

        return AmountRecognition(amount=amount, confidence=confidence)

    def recognize_pot(self, image: np.ndarray) -> AmountRecognition:
        """
        Recognize pot amount from image.

        Args:
            image: Pot ROI image

        Returns:
            AmountRecognition with amount and confidence
        """
        # Same logic as stack recognition
        return self.recognize_stack(image)

    def detect_dealer_button(self, image: np.ndarray) -> ButtonDetection:
        """
        Detect dealer button presence.

        Args:
            image: Button ROI image

        Returns:
            ButtonDetection with presence and confidence
        """
        # Simple color-based detection for now
        # Look for bright/white button indicator
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        else:
            gray = image

        # Check for bright pixels (button present)
        mean_brightness = np.mean(gray)
        threshold = 128

        present = mean_brightness > threshold
        confidence = min(abs(mean_brightness - threshold) / 128, 1.0)

        return ButtonDetection(present=present, confidence=confidence)
