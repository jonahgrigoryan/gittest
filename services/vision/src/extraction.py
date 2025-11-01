"""ROI extraction and element recognition."""

import time
import numpy as np
from typing import Dict, List, Any, Optional
from .types import ROI, Card, CardElement, StackElement, PotElement, ButtonElement


def extract_roi(frame: np.ndarray, roi: Dict[str, Any]) -> np.ndarray:
    """
    Extract subregion from frame using ROI coordinates.

    Args:
        frame: RGB numpy array of the full frame
        roi: ROI definition dict with x, y, width, height, relative

    Returns:
        Cropped image array

    Raises:
        ValueError: If ROI bounds are invalid
    """
    x, y = int(roi['x']), int(roi['y'])
    width, height = int(roi['width']), int(roi['height'])
    relative = roi.get('relative', False)

    frame_height, frame_width = frame.shape[:2]

    if relative:
        # Convert relative coordinates to absolute
        x = int(x * frame_width)
        y = int(y * frame_height)
        width = int(width * frame_width)
        height = int(height * frame_height)

    # Validate bounds
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise ValueError(f"Invalid ROI coordinates: x={x}, y={y}, w={width}, h={height}")

    if x + width > frame_width or y + height > frame_height:
        raise ValueError(f"ROI extends beyond frame bounds: frame={frame_width}x{frame_height}, roi_end=({x+width}, {y+height})")

    return frame[y:y+height, x:x+width]


def extract_all_rois(frame: np.ndarray, layout: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Extract all ROIs defined in layout pack.

    Args:
        frame: Full frame image
        layout: Layout pack dict

    Returns:
        Dict mapping element names to extracted image and metadata
    """
    results = {}
    start_time = time.time()

    # Extract card ROIs
    for i, roi in enumerate(layout['cardROIs']):
        try:
            img = extract_roi(frame, roi)
            results[f'card_{i}'] = {
                'image': img,
                'roi': roi,
                'extraction_time': time.time() - start_time
            }
        except Exception as e:
            results[f'card_{i}'] = {
                'error': str(e),
                'roi': roi,
                'extraction_time': time.time() - start_time
            }

    # Extract stack ROIs
    for position, roi in layout['stackROIs'].items():
        try:
            img = extract_roi(frame, roi)
            results[f'stack_{position}'] = {
                'image': img,
                'roi': roi,
                'extraction_time': time.time() - start_time
            }
        except Exception as e:
            results[f'stack_{position}'] = {
                'error': str(e),
                'roi': roi,
                'extraction_time': time.time() - start_time
            }

    # Extract pot ROI
    try:
        img = extract_roi(frame, layout['potROI'])
        results['pot'] = {
            'image': img,
            'roi': layout['potROI'],
            'extraction_time': time.time() - start_time
        }
    except Exception as e:
        results['pot'] = {
            'error': str(e),
            'roi': layout['potROI'],
            'extraction_time': time.time() - start_time
        }

    # Extract button ROI
    try:
        img = extract_roi(frame, layout['buttonROI'])
        results['button'] = {
            'image': img,
            'roi': layout['buttonROI'],
            'extraction_time': time.time() - start_time
        }
    except Exception as e:
        results['button'] = {
            'error': str(e),
            'roi': layout['buttonROI'],
            'extraction_time': time.time() - start_time
        }

    # Extract action button ROIs
    for action, roi in layout['actionButtonROIs'].items():
        try:
            img = extract_roi(frame, roi)
            results[f'action_{action}'] = {
                'image': img,
                'roi': roi,
                'extraction_time': time.time() - start_time
            }
        except Exception as e:
            results[f'action_{action}'] = {
                'error': str(e),
                'roi': roi,
                'extraction_time': time.time() - start_time
            }

    # Extract turn indicator ROI
    try:
        img = extract_roi(frame, layout['turnIndicatorROI'])
        results['turn_indicator'] = {
            'image': img,
            'roi': layout['turnIndicatorROI'],
            'extraction_time': time.time() - start_time
        }
    except Exception as e:
        results['turn_indicator'] = {
            'error': str(e),
            'roi': layout['turnIndicatorROI'],
            'extraction_time': time.time() - start_time
        }

    return results


class ElementRecognizer:
    """Recognizes poker elements from extracted images."""

    def __init__(self, model_manager=None, use_fallback: bool = True):
        self.model_manager = model_manager
        self.use_fallback = use_fallback

    def recognize_card(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognize a single card from image.

        Returns:
            Dict with rank, suit, confidence, method
        """
        # Placeholder implementation - returns dummy data
        # In real implementation, would use ONNX models
        return {
            'rank': 'A',
            'suit': 's',
            'confidence': 0.95,
            'method': 'placeholder'
        }

    def recognize_stack(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognize stack amount from image.

        Returns:
            Dict with amount, confidence
        """
        # Placeholder implementation
        return {
            'amount': 1000.0,
            'confidence': 0.90
        }

    def recognize_pot(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognize pot amount from image.

        Returns:
            Dict with amount, confidence
        """
        # Placeholder implementation
        return {
            'amount': 150.0,
            'confidence': 0.88
        }

    def detect_dealer_button(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Detect dealer button presence.

        Returns:
            Dict with present, confidence
        """
        # Placeholder implementation
        return {
            'present': True,
            'confidence': 0.92
        }