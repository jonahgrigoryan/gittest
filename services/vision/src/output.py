"""Vision output builder."""
import time
from typing import Dict, Any, Optional


class VisionOutputBuilder:
    """Builds VisionOutput objects."""
    
    def __init__(self):
        """Initialize builder with empty structure."""
        self.timestamp = int(time.time() * 1000)  # milliseconds
        self.capture_start = time.time()
        self.extraction_start: Optional[float] = None
        
        self.cards: Dict[str, Any] = {
            "holeCards": [],
            "communityCards": [],
            "confidence": 0.0
        }
        self.stacks: Dict[str, Dict[str, float]] = {}
        self.pot: Dict[str, float] = {"amount": 0.0, "confidence": 0.0}
        self.buttons: Dict[str, Any] = {"dealer": "BTN", "confidence": 0.0}
        self.positions: Dict[str, float] = {"confidence": 0.0}
        self.occlusion: Dict[str, float] = {}
        self.actionButtons: Optional[Dict[str, Any]] = None
        self.turnState: Optional[Dict[str, Any]] = None
        
        self.latency: Dict[str, float] = {
            "capture": 0.0,
            "extraction": 0.0,
            "total": 0.0
        }
    
    def set_cards(self, hole_cards: list, community_cards: list, confidence: float) -> None:
        """Set cards data."""
        self.cards = {
            "holeCards": hole_cards,
            "communityCards": community_cards,
            "confidence": confidence
        }
    
    def set_stack(self, position: str, amount: float, confidence: float) -> None:
        """Add stack data for position."""
        self.stacks[position] = {"amount": amount, "confidence": confidence}
    
    def set_pot(self, amount: float, confidence: float) -> None:
        """Set pot data."""
        self.pot = {"amount": amount, "confidence": confidence}
    
    def set_buttons(self, dealer: str, confidence: float) -> None:
        """Set dealer button position."""
        self.buttons = {"dealer": dealer, "confidence": confidence}
    
    def set_positions(self, confidence: float) -> None:
        """Set position assignment confidence."""
        self.positions = {"confidence": confidence}
    
    def set_occlusion(self, roi_name: str, occlusion_pct: float) -> None:
        """Track occlusion percentage per ROI."""
        self.occlusion[roi_name] = occlusion_pct
    
    def set_action_button(self, button_name: str, button_info: Dict[str, Any]) -> None:
        """Add action button info."""
        if self.actionButtons is None:
            self.actionButtons = {}
        self.actionButtons[button_name] = button_info
    
    def set_turn_state(self, is_hero_turn: bool, action_timer: Optional[int], confidence: float) -> None:
        """Set turn state."""
        self.turnState = {
            "isHeroTurn": is_hero_turn,
            "actionTimer": action_timer,
            "confidence": confidence
        }
    
    def mark_capture_complete(self) -> None:
        """Mark capture phase complete."""
        self.latency["capture"] = (time.time() - self.capture_start) * 1000  # ms
        self.extraction_start = time.time()
    
    def mark_extraction_complete(self) -> None:
        """Mark extraction phase complete."""
        if self.extraction_start:
            self.latency["extraction"] = (time.time() - self.extraction_start) * 1000  # ms
    
    def build(self) -> Dict[str, Any]:
        """
        Build complete VisionOutput.
        
        Returns:
            Dictionary matching VisionOutput structure
        """
        self.latency["total"] = (time.time() - self.capture_start) * 1000  # ms
        
        # Convert stacks Map to dict for JSON serialization
        stacks_dict = {}
        for pos, data in self.stacks.items():
            stacks_dict[pos] = data
        
        # Convert occlusion Map to dict
        occlusion_dict = {}
        for roi_name, pct in self.occlusion.items():
            occlusion_dict[roi_name] = pct
        
        result: Dict[str, Any] = {
            "timestamp": self.timestamp,
            "cards": self.cards,
            "stacks": stacks_dict,
            "pot": self.pot,
            "buttons": self.buttons,
            "positions": self.positions,
            "occlusion": occlusion_dict,
            "latency": self.latency
        }
        
        if self.actionButtons:
            result["actionButtons"] = self.actionButtons
        
        if self.turnState:
            result["turnState"] = self.turnState
        
        return result
