"""Vision output builder for constructing structured responses."""

import time
from typing import Any, Dict, List, Optional


class VisionOutputBuilder:
    """Build VisionOutput response structure."""

    def __init__(self):
        """Initialize empty output structure."""
        self.timestamp = int(time.time() * 1000)  # milliseconds
        self.hole_cards: List[Dict[str, str]] = []
        self.community_cards: List[Dict[str, str]] = []
        self.cards_confidence = 0.0
        self.stacks: Dict[str, Dict[str, Any]] = {}
        self.pot_amount = 0.0
        self.pot_confidence = 0.0
        self.dealer_position = ""
        self.dealer_confidence = 0.0
        self.positions_confidence = 0.0
        self.occlusion: Dict[str, float] = {}
        self.action_buttons: Dict[str, Any] = {}
        self.turn_state: Optional[Dict[str, Any]] = None

        # Timing
        self._capture_start = time.perf_counter()
        self._extraction_start: Optional[float] = None
        self.capture_time = 0.0
        self.extraction_time = 0.0

    def mark_extraction_start(self):
        """Mark start of extraction phase."""
        self.capture_time = (time.perf_counter() - self._capture_start) * 1000
        self._extraction_start = time.perf_counter()

    def set_cards(
        self, hole_cards: List[Dict[str, str]], community_cards: List[Dict[str, str]], confidence: float
    ):
        """Set card data."""
        self.hole_cards = hole_cards
        self.community_cards = community_cards
        self.cards_confidence = confidence

    def set_stack(self, position: str, amount: float, confidence: float):
        """Add stack data for a position."""
        self.stacks[position] = {"amount": amount, "confidence": confidence}

    def set_pot(self, amount: float, confidence: float):
        """Set pot data."""
        self.pot_amount = amount
        self.pot_confidence = confidence

    def set_buttons(self, dealer: str, confidence: float):
        """Set dealer button position."""
        self.dealer_position = dealer
        self.dealer_confidence = confidence

    def set_positions(self, confidence: float):
        """Set position assignment confidence."""
        self.positions_confidence = confidence

    def set_occlusion(self, roi_name: str, occlusion_pct: float):
        """Track occlusion percentage for ROI."""
        self.occlusion[roi_name] = occlusion_pct

    def set_action_button(self, button_name: str, button_info: Dict[str, Any]):
        """Add action button info (research UI mode)."""
        self.action_buttons[button_name] = button_info

    def set_turn_state(self, is_hero_turn: bool, action_timer: int, confidence: float):
        """Set turn state (research UI mode)."""
        self.turn_state = {
            "is_hero_turn": is_hero_turn,
            "action_timer": action_timer,
            "confidence": confidence,
        }

    def build(self) -> Dict[str, Any]:
        """
        Build final VisionOutput structure.

        Returns:
            Dictionary matching VisionOutput protobuf structure
        """
        if self._extraction_start:
            self.extraction_time = (time.perf_counter() - self._extraction_start) * 1000

        total_time = self.capture_time + self.extraction_time

        output = {
            "timestamp": self.timestamp,
            "cards": {
                "hole_cards": self.hole_cards,
                "community_cards": self.community_cards,
                "confidence": self.cards_confidence,
            },
            "stacks": self.stacks,
            "pot": {"amount": self.pot_amount, "confidence": self.pot_confidence},
            "buttons": {
                "dealer": self.dealer_position,
                "confidence": self.dealer_confidence,
            },
            "positions": {"confidence": self.positions_confidence},
            "occlusion": self.occlusion,
            "latency": {
                "capture": self.capture_time,
                "extraction": self.extraction_time,
                "total": total_time,
            },
        }

        # Add optional fields if present
        if self.action_buttons:
            output["action_buttons"] = self.action_buttons

        if self.turn_state:
            output["turn_state"] = self.turn_state

        return output
