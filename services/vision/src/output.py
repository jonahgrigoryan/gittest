"""VisionOutput builder and data structures."""

import time
from typing import Dict, Any, List, Optional
from collections import defaultdict


class VisionOutputBuilder:
    """Builds VisionOutput structure from detected elements."""

    def __init__(self):
        self.timestamp = int(time.time() * 1000)  # milliseconds
        self.capture_start = time.time()

        # Initialize data structures
        self.hole_cards: List[Dict[str, str]] = []
        self.community_cards: List[Dict[str, str]] = []
        self.cards_confidence = 0.0

        self.stacks: Dict[str, Dict[str, Any]] = {}
        self.pot: Dict[str, Any] = {'amount': 0.0, 'confidence': 0.0}
        self.buttons: Dict[str, Any] = {'dealer': 'BTN', 'confidence': 0.0}
        self.positions_confidence = 0.0

        # Action buttons (for research UI mode)
        self.action_buttons: Dict[str, Dict[str, Any]] = {}

        # Turn state (for research UI mode)
        self.turn_state: Optional[Dict[str, Any]] = None

        # Occlusion tracking
        self.occlusion: Dict[str, float] = defaultdict(float)

        # Latency tracking
        self.latency = {
            'capture': 0.0,
            'extraction': 0.0,
            'total': 0.0
        }

    def set_cards(self, hole_cards: List[Dict[str, Any]],
                  community_cards: List[Dict[str, Any]], confidence: float):
        """Set detected cards data."""
        self.hole_cards = [{'rank': c['rank'], 'suit': c['suit']} for c in hole_cards]
        self.community_cards = [{'rank': c['rank'], 'suit': c['suit']} for c in community_cards]
        self.cards_confidence = confidence

    def set_stack(self, position: str, amount: float, confidence: float):
        """Set stack amount for a position."""
        self.stacks[position] = {'amount': amount, 'confidence': confidence}

    def set_pot(self, amount: float, confidence: float):
        """Set pot amount."""
        self.pot = {'amount': amount, 'confidence': confidence}

    def set_buttons(self, dealer: str, confidence: float):
        """Set dealer button position."""
        self.buttons = {'dealer': dealer, 'confidence': confidence}

    def set_positions(self, confidence: float):
        """Set position assignment confidence."""
        self.positions_confidence = confidence

    def set_occlusion(self, roi_name: str, occlusion_pct: float):
        """Track occlusion percentage for ROI."""
        self.occlusion[roi_name] = occlusion_pct

    def set_action_button(self, button_name: str, button_info: Dict[str, Any]):
        """Set action button info (for research UI mode)."""
        self.action_buttons[button_name] = button_info

    def set_turn_state(self, is_hero_turn: bool, action_timer: Optional[int], confidence: float):
        """Set turn state (for research UI mode)."""
        self.turn_state = {
            'isHeroTurn': is_hero_turn,
            'actionTimer': action_timer,
            'confidence': confidence
        }

    def set_latency(self, capture: float, extraction: float):
        """Set latency measurements."""
        self.latency['capture'] = capture
        self.latency['extraction'] = extraction
        self.latency['total'] = time.time() - self.capture_start

    def build(self) -> Dict[str, Any]:
        """
        Build complete VisionOutput structure.

        Returns:
            Dict matching VisionOutput protobuf structure
        """
        # Calculate total latency
        self.latency['total'] = time.time() - self.capture_start

        # Convert stacks to Map format (position -> StackData)
        stacks_map = {}
        for position, stack_data in self.stacks.items():
            stacks_map[position] = {
                'amount': stack_data['amount'],
                'confidence': stack_data['confidence']
            }

        return {
            'timestamp': self.timestamp,
            'cards': {
                'holeCards': self.hole_cards,
                'communityCards': self.community_cards,
                'confidence': self.cards_confidence
            },
            'stacks': stacks_map,
            'pot': self.pot,
            'buttons': self.buttons,
            'positions': {
                'confidence': self.positions_confidence
            },
            'occlusion': dict(self.occlusion),
            'actionButtons': self.action_buttons if self.action_buttons else None,
            'turnState': self.turn_state,
            'latency': self.latency
        }