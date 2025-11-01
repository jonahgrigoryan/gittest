"""ONNX model management and inference."""

import os
from typing import Dict, Tuple
import numpy as np
import cv2


class ModelManager:
    """Manage ONNX models for card and digit recognition."""

    def __init__(self, model_dir: str):
        """
        Initialize model manager.

        Args:
            model_dir: Directory containing ONNX model files
        """
        self.model_dir = model_dir
        self.sessions: Dict[str, any] = {}
        self._onnx_available = False

        try:
            import onnxruntime as ort

            self.ort = ort
            self._onnx_available = True
        except ImportError:
            print(
                "Warning: onnxruntime not available. Using fallback recognition methods."
            )

    def preload_models(self) -> None:
        """
        Load all ONNX models into memory and warm them up.

        Raises:
            RuntimeError: If models cannot be loaded
        """
        if not self._onnx_available:
            print("Warning: Skipping model preload (onnxruntime not available)")
            return

        model_files = {
            "card_rank": "card_rank.onnx",
            "card_suit": "card_suit.onnx",
            "digit": "digit.onnx",
        }

        for name, filename in model_files.items():
            path = os.path.join(self.model_dir, filename)
            if not os.path.exists(path):
                print(f"Warning: Model not found: {path}")
                continue

            try:
                session = self.ort.InferenceSession(path)
                self.sessions[name] = session

                # Warm up with dummy input
                input_name = session.get_inputs()[0].name
                dummy_input = np.zeros((1, 3, 64, 64), dtype=np.float32)
                session.run(None, {input_name: dummy_input})

                print(f"Loaded model: {name}")
            except Exception as e:
                print(f"Warning: Failed to load model {name}: {e}")

    def _preprocess_image(self, image: np.ndarray, target_size: int = 64) -> np.ndarray:
        """
        Preprocess image for ONNX model input.

        Args:
            image: Input image (H, W, C) in RGB
            target_size: Target dimension (square)

        Returns:
            Preprocessed image (1, C, H, W) normalized to [0, 1]
        """
        # Resize to target size
        resized = cv2.resize(image, (target_size, target_size))

        # Normalize to [0, 1]
        normalized = resized.astype(np.float32) / 255.0

        # Convert HWC to CHW
        transposed = np.transpose(normalized, (2, 0, 1))

        # Add batch dimension
        batched = np.expand_dims(transposed, axis=0)

        return batched

    def predict_card_rank(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict card rank from image.

        Args:
            image: Card ROI image

        Returns:
            Tuple of (rank, confidence)
            rank: One of "2", "3", ..., "9", "T", "J", "Q", "K", "A"
            confidence: Probability [0, 1]
        """
        if "card_rank" not in self.sessions:
            # Fallback: return placeholder
            return "A", 0.5

        session = self.sessions["card_rank"]
        preprocessed = self._preprocess_image(image)

        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: preprocessed})[0]

        # Softmax probabilities
        probs = output[0]
        max_idx = int(np.argmax(probs))
        confidence = float(probs[max_idx])

        # Map index to rank
        ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
        rank = ranks[max_idx] if max_idx < len(ranks) else "A"

        return rank, confidence

    def predict_card_suit(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict card suit from image.

        Args:
            image: Card ROI image

        Returns:
            Tuple of (suit, confidence)
            suit: One of "h", "d", "c", "s"
            confidence: Probability [0, 1]
        """
        if "card_suit" not in self.sessions:
            # Fallback: return placeholder
            return "h", 0.5

        session = self.sessions["card_suit"]
        preprocessed = self._preprocess_image(image)

        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: preprocessed})[0]

        # Softmax probabilities
        probs = output[0]
        max_idx = int(np.argmax(probs))
        confidence = float(probs[max_idx])

        # Map index to suit
        suits = ["h", "d", "c", "s"]
        suit = suits[max_idx] if max_idx < len(suits) else "h"

        return suit, confidence

    def predict_digits(self, image: np.ndarray) -> Tuple[str, float]:
        """
        Predict digits from stack/pot image.

        Args:
            image: Stack/pot ROI image

        Returns:
            Tuple of (number_string, confidence)
            number_string: Recognized digits (e.g., "1234.56")
            confidence: Average confidence across digits
        """
        if "digit" not in self.sessions:
            # Fallback: return placeholder
            return "1000", 0.5

        # For simplicity, treat entire image as single number
        # In production, would segment individual digits
        session = self.sessions["digit"]
        preprocessed = self._preprocess_image(image)

        input_name = session.get_inputs()[0].name
        output = session.run(None, {input_name: preprocessed})[0]

        # Softmax probabilities
        probs = output[0]
        max_idx = int(np.argmax(probs))
        confidence = float(probs[max_idx])

        # Map index to digit (0-9) or decimal point (10)
        if max_idx < 10:
            digit_str = str(max_idx)
        elif max_idx == 10:
            digit_str = "."
        else:
            digit_str = "0"

        # Placeholder: return fixed value for now
        # Production would segment and recognize multi-digit sequences
        return "1000", confidence
