"""Type definitions for Python vision service."""
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass

@dataclass
class Card:
    rank: str
    suit: str

@dataclass
class StackData:
    amount: float
    confidence: float

@dataclass
class ButtonInfo:
    screen_coords: Tuple[int, int]
    is_enabled: bool
    is_visible: bool
    confidence: float
    text: Optional[str] = None

@dataclass
class TurnState:
    is_hero_turn: bool
    action_timer: Optional[int]
    confidence: float
