"""ONNX model loading and inference."""

import os
import numpy as np
from typing import Tuple, Optional
import onnxruntime as ort


class ModelManager:
    """Manages ONNX model loading and inference."""

    def __init__(self, model_dir: str):
        self.model_dir = model_dir
        self.models = {}
        self._load_models()

    def _load_models(self):
        """Load all available ONNX models."""
        model_files = {
            'card_rank': 'card_rank.onnx',
            'card_suit': 'card_suit.onnx',
            'digit': 'digit.onnx'
        }

        for model_name, filename in model_files.items():
            model_path = os.path.join(self.model_dir, filename)
            if os.path.exists(model_path):
                try:
                    self.models[model_name] = ort.InferenceSession(model_path)
                    print(f"Loaded model: {model_name}")
                except Exception as e:
                    print(f"Failed to load model {model_name}: {e}")
            else:
                print(f"Model file not found: {model_path}")

    def _preprocess_image(self, image: np.ndarray, target_size: Tuple[int, int] = (64, 64)) -> np.ndarray:
        """Preprocess image for model input."""
        # Resize to target size
        if image.shape[:2] != target_size:
            # Simple resize - in production use proper interpolation
            h, w = image.shape[:2]
            scale_h = target_size[0] / h
            scale_w = target_size[1] / w

            # Very basic resize (placeholder)
            resized = np.zeros((target_size[0], target_size[1], 3), dtype=np.uint8)
            for i in range(target_size[0]):
                for j in range(target_size[1]):
                    orig_i = int(i / scale_h)
                    orig_j = int(j / scale_w)
                    if orig_i < h and orig_j < w:
                        resized[i, j] = image[orig_i, orig_j]
            image = resized

        # Convert to float32 and normalize to [0, 1]
        image = image.astype(np.float32) / 255.0

        # Add batch dimension and transpose to CHW
        image = np.transpose(image, (2, 0, 1))  # HWC to CHW
        image = np.expand_dims(image, axis=0)  # Add batch dim

        return image

    def predict_card_rank(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict card rank from image.

        Returns:
            Tuple of (rank, confidence)
        """
        if 'card_rank' not in self.models:
            return 'A', 0.0  # Fallback

        try:
            processed = self._preprocess_image(image)
            outputs = self.models['card_rank'].run(None, {'input': processed})
            probs = outputs[0][0]  # Remove batch dim

            # Map to ranks (2, 3, 4, 5, 6, 7, 8, 9, T, J, Q, K, A)
            ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
            best_idx = np.argmax(probs)
            confidence = float(probs[best_idx])

            return ranks[best_idx], confidence
        except Exception as e:
            print(f"Card rank prediction failed: {e}")
            return 'A', 0.0

    def predict_card_suit(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict card suit from image.

        Returns:
            Tuple of (suit, confidence)
        """
        if 'card_suit' not in self.models:
            return 's', 0.0  # Fallback

        try:
            processed = self._preprocess_image(image)
            outputs = self.models['card_suit'].run(None, {'input': processed})
            probs = outputs[0][0]  # Remove batch dim

            # Map to suits (hearts, diamonds, clubs, spades)
            suits = ['h', 'd', 'c', 's']
            best_idx = np.argmax(probs)
            confidence = float(probs[best_idx])

            return suits[best_idx], confidence
        except Exception as e:
            print(f"Card suit prediction failed: {e}")
            return 's', 0.0

    def predict_digits(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Recognize digits from image.

        Returns:
            Tuple of (number_string, confidence)
        """
        if 'digit' not in self.models:
            return '1000', 0.0  # Fallback

        try:
            processed = self._preprocess_image(image)
            outputs = self.models['digit'].run(None, {'input': processed})
            probs = outputs[0][0]  # Remove batch dim

            # For now, assume single digit recognition (0-9)
            # In production, would need multi-digit OCR
            digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
            best_idx = np.argmax(probs)
            confidence = float(probs[best_idx])

            return digits[best_idx], confidence
        except Exception as e:
            print(f"Digit recognition failed: {e}")
            return '0', 0.0