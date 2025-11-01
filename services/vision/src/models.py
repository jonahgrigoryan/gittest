"""ONNX model loading and inference."""
import os
import numpy as np
import onnxruntime as ort
from typing import Tuple, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class ModelManager:
    """Manages ONNX model loading and inference."""
    
    def __init__(self, model_dir: str):
        """
        Initialize model manager.
        
        Args:
            model_dir: Directory containing ONNX model files
        """
        self.model_dir = model_dir
        self.sessions: Dict[str, ort.InferenceSession] = {}
        
    def preload_models(self) -> None:
        """Load all ONNX models into memory and warm up."""
        models = {
            "card_rank": "card_rank.onnx",
            "card_suit": "card_suit.onnx",
            "digit": "digit.onnx",
        }
        
        for name, filename in models.items():
            model_path = os.path.join(self.model_dir, filename)
            
            if not os.path.exists(model_path):
                logger.warning(f"Model {filename} not found at {model_path}, skipping")
                continue
            
            try:
                session = ort.InferenceSession(
                    model_path,
                    providers=["CPUExecutionProvider"]
                )
                self.sessions[name] = session
                
                # Warm up with dummy input
                self._warmup_session(name, session)
                logger.info(f"Loaded model: {name}")
            
            except Exception as e:
                logger.error(f"Failed to load model {name}: {e}")
    
    def _warmup_session(self, name: str, session: ort.InferenceSession) -> None:
        """Warm up model with dummy input."""
        try:
            input_shape = session.get_inputs()[0].shape
            # Handle dynamic dimensions
            dummy_shape = [1 if d == -1 or d is None else d for d in input_shape]
            dummy_input = np.random.randn(*dummy_shape).astype(np.float32)
            
            # Normalize to [0, 1] range if needed
            if name.startswith("card") or name == "digit":
                dummy_input = (dummy_input - dummy_input.min()) / (dummy_input.max() - dummy_input.min() + 1e-8)
            
            _ = session.run(None, {session.get_inputs()[0].name: dummy_input})
        except Exception as e:
            logger.warning(f"Failed to warm up {name}: {e}")
    
    def _preprocess_image(self, image: np.ndarray, target_size: Tuple[int, int] = (64, 64)) -> np.ndarray:
        """
        Preprocess image for model input.
        
        Args:
            image: Input image (H, W, 3) uint8
            target_size: Target size (height, width)
        
        Returns:
            Preprocessed image (1, H, W, 3) float32 normalized [0, 1]
        """
        import cv2
        
        # Resize
        resized = cv2.resize(image, target_size, interpolation=cv2.INTER_LINEAR)
        
        # Normalize to [0, 1]
        normalized = resized.astype(np.float32) / 255.0
        
        # Add batch dimension
        batch = np.expand_dims(normalized, axis=0)
        
        return batch
    
    def predict_card_rank(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict card rank from image.
        
        Args:
            image: Card image (H, W, 3)
        
        Returns:
            (rank, confidence) tuple
        """
        if "card_rank" not in self.sessions:
            # Fallback: return unknown
            return ("?", 0.0)
        
        session = self.sessions["card_rank"]
        preprocessed = self._preprocess_image(image)
        
        try:
            outputs = session.run(None, {session.get_inputs()[0].name: preprocessed})
            probs = outputs[0][0]  # Remove batch dimension
            
            # Map to rank
            rank_idx = int(np.argmax(probs))
            confidence = float(probs[rank_idx])
            
            ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
            rank = ranks[rank_idx] if rank_idx < len(ranks) else "?"
            
            return (rank, confidence)
        
        except Exception as e:
            logger.error(f"Card rank prediction failed: {e}")
            return ("?", 0.0)
    
    def predict_card_suit(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict card suit from image.
        
        Args:
            image: Card image (H, W, 3)
        
        Returns:
            (suit, confidence) tuple
        """
        if "card_suit" not in self.sessions:
            return ("?", 0.0)
        
        session = self.sessions["card_suit"]
        preprocessed = self._preprocess_image(image)
        
        try:
            outputs = session.run(None, {session.get_inputs()[0].name: preprocessed})
            probs = outputs[0][0]
            
            suit_idx = int(np.argmax(probs))
            confidence = float(probs[suit_idx])
            
            suits = ["h", "d", "c", "s"]  # hearts, diamonds, clubs, spades
            suit = suits[suit_idx] if suit_idx < len(suits) else "?"
            
            return (suit, confidence)
        
        except Exception as e:
            logger.error(f"Card suit prediction failed: {e}")
            return ("?", 0.0)
    
    def predict_digits(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict digits from image (for stack/pot amounts).
        
        Args:
            image: Digit image (H, W, 3)
        
        Returns:
            (number_string, confidence) tuple
        """
        if "digit" not in self.sessions:
            # Fallback: return 0
            return ("0", 0.0)
        
        session = self.sessions["digit"]
        preprocessed = self._preprocess_image(image)
        
        try:
            outputs = session.run(None, {session.get_inputs()[0].name: preprocessed})
            probs = outputs[0][0]
            
            digit_idx = int(np.argmax(probs))
            confidence = float(probs[digit_idx])
            
            digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "."]
            digit = digits[digit_idx] if digit_idx < len(digits) else "0"
            
            # For multi-digit, we'd need to segment first
            # For now, return single digit
            return (digit, confidence)
        
        except Exception as e:
            logger.error(f"Digit prediction failed: {e}")
            return ("0", 0.0)
