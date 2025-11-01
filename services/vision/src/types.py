"""Type definitions for vision service."""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np


class ROI:
    """Region of Interest definition."""
    def __init__(self, x: int, y: int, width: int, height: int, relative: bool = False):
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.relative = relative

    def to_dict(self) -> Dict[str, Any]:
        return {
            'x': self.x,
            'y': self.y,
            'width': self.width,
            'height': self.height,
            'relative': self.relative
        }


class Card:
    """Poker card representation."""
    def __init__(self, rank: str, suit: str):
        self.rank = rank  # '2'-'A'
        self.suit = suit  # 'h', 'd', 'c', 's'

    def to_dict(self) -> Dict[str, str]:
        return {'rank': self.rank, 'suit': self.suit}


class VisionElement:
    """Base class for vision-detected elements."""
    def __init__(self, confidence: float):
        self.confidence = confidence


class CardElement(VisionElement):
    """Detected card element."""
    def __init__(self, card: Card, confidence: float):
        super().__init__(confidence)
        self.card = card


class StackElement(VisionElement):
    """Detected stack element."""
    def __init__(self, amount: float, confidence: float):
        super().__init__(confidence)
        self.amount = amount


class PotElement(VisionElement):
    """Detected pot element."""
    def __init__(self, amount: float, confidence: float):
        super().__init__(confidence)
        self.amount = amount


class ButtonElement(VisionElement):
    """Detected dealer button element."""
    def __init__(self, present: bool, confidence: float):
        super().__init__(confidence)
        self.present = present