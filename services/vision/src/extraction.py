"""ROI extraction from frames."""
import numpy as np
import time
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)


def extract_roi(frame: np.ndarray, roi: Dict[str, Any]) -> np.ndarray:
    """
    Extract subregion from frame using ROI coordinates.
    
    Args:
        frame: Full frame image (H, W, 3)
        roi: ROI dictionary with x, y, width, height, optional relative flag
    
    Returns:
        Cropped image array
    """
    x = int(roi["x"])
    y = int(roi["y"])
    width = int(roi["width"])
    height = int(roi["height"])
    
    # Handle relative coordinates
    if roi.get("relative", False):
        frame_h, frame_w = frame.shape[:2]
        x = int(x * frame_w)
        y = int(y * frame_h)
        width = int(width * frame_w)
        height = int(height * frame_h)
    
    # Validate bounds
    frame_h, frame_w = frame.shape[:2]
    x = max(0, min(x, frame_w - 1))
    y = max(0, min(y, frame_h - 1))
    width = min(width, frame_w - x)
    height = min(height, frame_h - y)
    
    if width <= 0 or height <= 0:
        logger.warning(f"Invalid ROI bounds: x={x}, y={y}, w={width}, h={height}")
        return np.zeros((64, 64, 3), dtype=np.uint8)
    
    extracted = frame[y:y+height, x:x+width]
    return extracted


def extract_all_rois(frame: np.ndarray, layout: Dict[str, Any]) -> Dict[str, np.ndarray]:
    """
    Extract all ROIs defined in layout pack.
    
    Args:
        frame: Full frame image
        layout: Layout pack dictionary
    
    Returns:
        Dictionary mapping element name to cropped image
    """
    start_time = time.time()
    rois = {}
    
    # Extract card ROIs
    if "cardROIs" in layout:
        for idx, roi in enumerate(layout["cardROIs"]):
            rois[f"card_{idx}"] = extract_roi(frame, roi)
    
    # Extract stack ROIs
    if "stackROIs" in layout:
        for position, roi in layout["stackROIs"].items():
            rois[f"stack_{position}"] = extract_roi(frame, roi)
    
    # Extract pot ROI
    if "potROI" in layout:
        rois["pot"] = extract_roi(frame, layout["potROI"])
    
    # Extract button ROI
    if "buttonROI" in layout:
        rois["button"] = extract_roi(frame, layout["buttonROI"])
    
    # Extract action button ROIs
    if "actionButtonROIs" in layout:
        for button_name, roi in layout["actionButtonROIs"].items():
            rois[f"action_{button_name}"] = extract_roi(frame, roi)
    
    # Extract turn indicator ROI
    if "turnIndicatorROI" in layout:
        rois["turn_indicator"] = extract_roi(frame, layout["turnIndicatorROI"])
    
    extraction_time = time.time() - start_time
    
    return rois
