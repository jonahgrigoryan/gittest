"""Build structured VisionOutput payloads."""

from __future__ import annotations

from typing import Dict, List, Optional

from time import perf_counter, time


class VisionOutputBuilder:
  """Incrementally build a VisionOutput-compatible dictionary."""

  def __init__(self) -> None:
    self._timestamp = int(time() * 1000)
    self._cards: Dict[str, object] = {
      "holeCards": [],
      "communityCards": [],
      "confidence": 0.0
    }
    self._stacks: Dict[str, Dict[str, float]] = {}
    self._pot: Dict[str, float] = {"amount": 0.0, "confidence": 0.0}
    self._buttons: Dict[str, object] = {"dealer": "", "confidence": 0.0}
    self._positions_confidence = 0.0
    self._occlusion: Dict[str, float] = {}
    self._action_buttons: Dict[str, Dict[str, object]] = {}
    self._turn_state: Optional[Dict[str, object]] = None
    self._latency: Dict[str, float] = {"capture": 0.0, "extraction": 0.0, "total": 0.0}

    self._capture_start = perf_counter()
    self._extraction_start: Optional[float] = None

  def mark_capture_complete(self) -> None:
    self._latency["capture"] = perf_counter() - self._capture_start
    self._extraction_start = perf_counter()

  def mark_extraction_complete(self) -> None:
    if self._extraction_start is None:
      self._latency["extraction"] = 0.0
    else:
      self._latency["extraction"] = perf_counter() - self._extraction_start
    self._latency["total"] = self._latency["capture"] + self._latency["extraction"]

  def set_cards(self, hole_cards: List[Dict[str, str]], community_cards: List[Dict[str, str]], confidence: float) -> None:
    self._cards = {
      "holeCards": hole_cards,
      "communityCards": community_cards,
      "confidence": max(0.0, min(confidence, 1.0))
    }

  def set_stack(self, position: str, amount: float, confidence: float) -> None:
    self._stacks[position] = {
      "amount": float(amount),
      "confidence": max(0.0, min(confidence, 1.0))
    }

  def set_pot(self, amount: float, confidence: float) -> None:
    self._pot = {"amount": float(amount), "confidence": max(0.0, min(confidence, 1.0))}

  def set_buttons(self, dealer: str, confidence: float) -> None:
    self._buttons = {"dealer": dealer, "confidence": max(0.0, min(confidence, 1.0))}

  def set_positions(self, confidence: float) -> None:
    self._positions_confidence = max(0.0, min(confidence, 1.0))

  def set_occlusion(self, roi_name: str, occlusion_pct: float) -> None:
    self._occlusion[roi_name] = max(0.0, min(occlusion_pct, 1.0))

  def set_action_button(self, button_name: str, button_info: Dict[str, object]) -> None:
    self._action_buttons[button_name] = button_info

  def set_turn_state(self, is_hero_turn: bool, action_timer: Optional[int], confidence: float) -> None:
    self._turn_state = {
      "isHeroTurn": is_hero_turn,
      "actionTimer": action_timer if action_timer is not None else 0,
      "confidence": max(0.0, min(confidence, 1.0))
    }

  def build(self) -> Dict[str, object]:
    if self._latency["total"] == 0.0:
      elapsed = perf_counter() - self._capture_start
      if self._latency["extraction"] == 0.0:
        self._latency["extraction"] = max(0.0, elapsed - self._latency["capture"])
      self._latency["total"] = self._latency["capture"] + self._latency["extraction"]

    output: Dict[str, object] = {
      "timestamp": self._timestamp,
      "cards": self._cards,
      "stacks": self._stacks,
      "pot": self._pot,
      "buttons": self._buttons,
      "positions": {"confidence": self._positions_confidence},
      "occlusion": self._occlusion,
      "latency": self._latency
    }

    if self._action_buttons:
      output["actionButtons"] = self._action_buttons

    if self._turn_state is not None:
      output["turnState"] = self._turn_state

    return output
