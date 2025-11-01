"""Element recognition using ONNX models and fallback."""
import numpy as np
from typing import Dict, Any
from .models import ModelManager
from .fallback import recognize_card_template, recognize_digits_ocr
import logging

logger = logging.getLogger(__name__)


class ElementRecognizer:
    """Recognizes elements from extracted ROIs."""
    
    def __init__(self, model_manager: ModelManager, use_fallback: bool = True):
        """
        Initialize element recognizer.
        
        Args:
            model_manager: ModelManager instance
            use_fallback: Whether to use template matching fallback
        """
        self.model_manager = model_manager
        self.use_fallback = use_fallback
    
    def recognize_card(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognize card from image.
        
        Args:
            image: Card image ROI
        
        Returns:
            Dictionary with rank, suit, confidence, method
        """
        # Try ONNX models first
        rank, rank_conf = self.model_manager.predict_card_rank(image)
        suit, suit_conf = self.model_manager.predict_card_suit(image)
        
        overall_conf = (rank_conf + suit_conf) / 2.0
        
        # Fall back to template matching if confidence low
        if self.use_fallback and overall_conf < 0.8:
            # Would need templates loaded for this
            # For now, return ONNX results
            pass
        
        return {
            "rank": rank,
            "suit": suit,
            "confidence": overall_conf,
            "method": "onnx" if overall_conf >= 0.8 else "fallback"
        }
    
    def recognize_stack(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognize stack amount from image.
        
        Args:
            image: Stack ROI image
        
        Returns:
            Dictionary with amount, confidence
        """
        # Try ONNX digit recognition
        digit, conf = self.model_manager.predict_digits(image)
        
        # For now, single digit - would need segmentation for multi-digit
        try:
            amount = float(digit)
        except ValueError:
            amount = 0.0
            conf = 0.0
        
        # Fallback to OCR if available
        if self.use_fallback and conf < 0.7:
            text, ocr_conf = recognize_digits_ocr(image)
            try:
                fallback_amount = float(text)
                if ocr_conf > conf:
                    amount = fallback_amount
                    conf = ocr_conf
            except ValueError:
                pass
        
        return {
            "amount": amount,
            "confidence": conf
        }
    
    def recognize_pot(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Recognize pot amount from image.
        
        Args:
            image: Pot ROI image
        
        Returns:
            Dictionary with amount, confidence
        """
        # Same as stack recognition
        return self.recognize_stack(image)
    
    def detect_dealer_button(self, image: np.ndarray) -> Dict[str, Any]:
        """
        Detect dealer button presence.
        
        Args:
            image: Button ROI image
        
        Returns:
            Dictionary with present flag, confidence
        """
        # Simple color-based detection
        # Button is typically white/light colored
        mean_brightness = np.mean(image)
        threshold = 200  # Adjust based on theme
        
        present = mean_brightness > threshold
        confidence = min(1.0, abs(mean_brightness - threshold) / 50.0)
        
        return {
            "present": present,
            "confidence": confidence
        }
