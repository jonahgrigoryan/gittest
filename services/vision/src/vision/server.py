"""gRPC server implementation for the poker vision service."""

from __future__ import annotations

import json
import logging
import os
from concurrent import futures
from statistics import fmean
from typing import Dict, List, Mapping, Optional, Sequence

import grpc

from .capture import ScreenCapture, ScreenCaptureError
from .extraction import ElementRecognizer, extract_all_rois
from .models import ModelManager
from .occlusion import detect_occlusion
from .output import VisionOutputBuilder
from .vision_types import LayoutPack
from . import vision_pb2
from . import vision_pb2_grpc

LOGGER = logging.getLogger(__name__)


class VisionServicer(vision_pb2_grpc.VisionServiceServicer):
  """Serve CaptureFrame/HealthCheck RPCs backed by the local vision pipeline."""

  def __init__(
    self,
    model_manager: ModelManager,
    *,
    capture: Optional[ScreenCapture] = None,
    recognizer: Optional[ElementRecognizer] = None
  ) -> None:
    self._models = model_manager
    self._capture = capture or ScreenCapture()
    self._recognizer = recognizer or ElementRecognizer(model_manager)

  def CaptureFrame(
    self,
    request: vision_pb2.CaptureRequest,
    context: grpc.ServicerContext
  ) -> vision_pb2.VisionOutput:
    try:
      layout = self._parse_layout(request.layout_json)
    except ValueError as exc:  # pragma: no cover - validation handled via gRPC status
      context.abort(grpc.StatusCode.INVALID_ARGUMENT, f"Invalid layout JSON: {exc}")

    try:
      frame = self._capture.capture_frame()
    except ScreenCaptureError as exc:  # pragma: no cover - device failure path
      LOGGER.error("Screen capture failed: %s", exc)
      context.abort(grpc.StatusCode.UNAVAILABLE, f"Screen capture failed: {exc}")
      raise

    builder = VisionOutputBuilder()
    builder.mark_capture_complete()
    elements = extract_all_rois(frame, layout)

    self._process_cards(elements.get("cards", []), builder)
    self._process_stacks(elements.get("stacks", {}), builder)
    self._process_pot(elements.get("pot"), builder)
    self._process_button(elements.get("button"), builder)
    self._process_turn_indicator(elements.get("turnIndicator"), builder)
    self._process_action_buttons(elements.get("actionButtons", {}), builder)

    builder.mark_extraction_complete()
    payload = builder.build()
    return self._to_proto(payload)

  def HealthCheck(
    self,
    request: vision_pb2.Empty,
    context: grpc.ServicerContext
  ) -> vision_pb2.HealthStatus:
    # A lightweight health check that confirms the service is responsive.
    return vision_pb2.HealthStatus(healthy=True, message="ready")

  @staticmethod
  def _record_occlusion(builder: VisionOutputBuilder, roi_name: str, region: Mapping[str, object]) -> None:
    image = region.get("image")
    roi = region.get("roi")
    if image is None or roi is None:
      return
    _, occlusion_score = detect_occlusion(image, roi)  # heuristic score in [0, 1]
    builder.set_occlusion(roi_name, occlusion_score)

  def _process_cards(self, cards: Sequence[Mapping[str, object]], builder: VisionOutputBuilder) -> None:
    hole_cards: List[Dict[str, str]] = []
    community_cards: List[Dict[str, str]] = []
    confidences: List[float] = []

    for index, region in enumerate(cards):
      card_result = self._recognizer.recognize_card(region["image"])
      confidences.append(float(card_result.get("confidence", 0.0)))
      card_entry = {
        "rank": str(card_result.get("rank", "?")),
        "suit": str(card_result.get("suit", "?"))
      }
      if index < 2:
        hole_cards.append(card_entry)
      else:
        community_cards.append(card_entry)
      self._record_occlusion(builder, f"card_{index}", region)

    builder.set_cards(
      hole_cards,
      community_cards[:5],
      fmean(confidences) if confidences else 0.0
    )

  def _process_stacks(
    self,
    stacks: Mapping[str, Mapping[str, object]],
    builder: VisionOutputBuilder
  ) -> None:
    confidences: List[float] = []
    for position, region in stacks.items():
      stack_result = self._recognizer.recognize_stack(region["image"])
      builder.set_stack(position, float(stack_result.get("amount", 0.0)), float(stack_result.get("confidence", 0.0)))
      confidences.append(float(stack_result.get("confidence", 0.0)))
      self._record_occlusion(builder, f"stack_{position}", region)

    if confidences:
      builder.set_positions(fmean(confidences))

  def _process_pot(
    self,
    pot_region: Optional[Mapping[str, object]],
    builder: VisionOutputBuilder
  ) -> None:
    if pot_region is None:
      return
    pot_result = self._recognizer.recognize_pot(pot_region["image"])
    builder.set_pot(float(pot_result.get("amount", 0.0)), float(pot_result.get("confidence", 0.0)))
    self._record_occlusion(builder, "pot", pot_region)

  def _process_button(
    self,
    button_region: Optional[Mapping[str, object]],
    builder: VisionOutputBuilder
  ) -> None:
    if button_region is None:
      builder.set_buttons("BTN", 0.0)
      return

    button_result = self._recognizer.detect_dealer_button(button_region["image"])
    dealer = "BTN" if button_result.get("present") else "SB"
    builder.set_buttons(dealer, float(button_result.get("confidence", 0.0)))
    builder.set_positions(float(button_result.get("confidence", 0.0)))
    self._record_occlusion(builder, "dealer_button", button_region)

  def _process_turn_indicator(
    self,
    turn_region: Optional[Mapping[str, object]],
    builder: VisionOutputBuilder
  ) -> None:
    if turn_region is None:
      return
    self._record_occlusion(builder, "turn_indicator", turn_region)

  def _process_action_buttons(
    self,
    buttons: Mapping[str, Mapping[str, object]],
    builder: VisionOutputBuilder
  ) -> None:
    for raw_name, region in buttons.items():
      proto_name = "all_in" if raw_name in {"allIn", "all_in"} else raw_name
      # Placeholder metadata: mark button as visible if variance is high enough.
      _, occlusion_score = detect_occlusion(region["image"], region["roi"])
      button_info = {
        "screen_coords": (
          int(round(float(region["roi"]["x"]))),
          int(round(float(region["roi"]["y"])))
        ),
        "is_enabled": occlusion_score < 0.5,
        "is_visible": True,
        "confidence": 1.0 - occlusion_score,
        "text": raw_name
      }
      builder.set_action_button(proto_name, button_info)
      builder.set_occlusion(f"action_button_{proto_name}", occlusion_score)

  @staticmethod
  def _parse_layout(layout_json: str) -> LayoutPack:
    if not layout_json:
      raise ValueError("layout_json is empty")
    data = json.loads(layout_json)
    return data

  def _to_proto(self, payload: Dict[str, object]) -> vision_pb2.VisionOutput:
    cards_section = payload.get("cards", {})
    card_message = vision_pb2.CardData(
      hole_cards=[vision_pb2.Card(rank=card.get("rank", ""), suit=card.get("suit", "")) for card in cards_section.get("hole_cards", [])],
      community_cards=[
        vision_pb2.Card(rank=card.get("rank", ""), suit=card.get("suit", ""))
        for card in cards_section.get("community_cards", [])
      ],
      confidence=float(cards_section.get("confidence", 0.0))
    )

    pot_section = payload.get("pot") or {"amount": 0.0, "confidence": 0.0}
    pot_message = vision_pb2.AmountData(
      amount=float(pot_section.get("amount", 0.0)),
      confidence=float(pot_section.get("confidence", 0.0))
    )

    buttons_section = payload.get("buttons") or {"dealer": "BTN", "confidence": 0.0}
    button_message = vision_pb2.ButtonData(
      dealer=str(buttons_section.get("dealer", "BTN")),
      confidence=float(buttons_section.get("confidence", 0.0))
    )

    positions_conf = payload.get("positions", {}).get("confidence", 0.0) if payload.get("positions") else 0.0
    positions_message = vision_pb2.PositionData(confidence=float(positions_conf))

    latency_section = payload.get("latency") or {"capture": 0.0, "extraction": 0.0, "total": 0.0}
    latency_message = vision_pb2.LatencyData(
      capture=float(latency_section.get("capture", 0.0)),
      extraction=float(latency_section.get("extraction", 0.0)),
      total=float(latency_section.get("total", 0.0))
    )

    vision_output = vision_pb2.VisionOutput(
      timestamp=int(payload.get("timestamp", 0)),
      cards=card_message,
      pot=pot_message,
      buttons=button_message,
      positions=positions_message,
      latency=latency_message
    )

    vision_output.stacks.update({
      position: vision_pb2.StackData(
        amount=float(stack_info.get("amount", 0.0)),
        confidence=float(stack_info.get("confidence", 0.0))
      )
      for position, stack_info in (payload.get("stacks") or {}).items()
    })

    vision_output.occlusion.update(payload.get("occlusion") or {})

    action_buttons_payload = payload.get("action_buttons") or {}
    if action_buttons_payload:
      action_buttons_message = vision_pb2.ActionButtons()
      for name, metadata in action_buttons_payload.items():
        button_info = vision_pb2.ButtonInfo(
          is_enabled=bool(metadata.get("is_enabled")),
          is_visible=bool(metadata.get("is_visible")),
          confidence=float(metadata.get("confidence", 0.0)),
          text=str(metadata.get("text", ""))
        )
        coords = metadata.get("screen_coords")
        if isinstance(coords, tuple) or isinstance(coords, list):
          button_info.screen_coords.CopyFrom(
            vision_pb2.ScreenCoords(x=int(coords[0]), y=int(coords[1]))
          )
        setattr(action_buttons_message, name, button_info)
      vision_output.action_buttons.CopyFrom(action_buttons_message)

    turn_state_payload = payload.get("turn_state")
    if isinstance(turn_state_payload, Mapping):
      turn_state_message = vision_pb2.TurnState(
        is_hero_turn=bool(turn_state_payload.get("is_hero_turn")),
        action_timer=int(turn_state_payload.get("action_timer", 0)),
        confidence=float(turn_state_payload.get("confidence", 0.0))
      )
      vision_output.turn_state.CopyFrom(turn_state_message)

    return vision_output


def serve(
  *,
  port: int = 50052,
  model_dir: Optional[str] = None,
  max_workers: int = 4
) -> grpc.Server:
  """Start the gRPC server and block until it is shut down."""

  address = f"[::]:{port}"
  server = grpc.server(futures.ThreadPoolExecutor(max_workers=max_workers))

  resolved_model_dir = model_dir or os.environ.get("VISION_MODEL_DIR", "models")
  model_manager = ModelManager(resolved_model_dir)
  model_manager.preload_models()

  servicer = VisionServicer(model_manager)
  vision_pb2_grpc.add_VisionServiceServicer_to_server(servicer, server)
  server.add_insecure_port(address)
  server.start()

  LOGGER.info("Vision service listening on %s (models: %s)", address, resolved_model_dir)
  return server


if __name__ == "__main__":
  logging.basicConfig(level=logging.INFO)
  port = int(os.environ.get("VISION_PORT", "50052"))
  model_dir = os.environ.get("VISION_MODEL_PATH") or os.environ.get("VISION_MODEL_DIR")
  max_workers = int(os.environ.get("VISION_MAX_WORKERS", "4"))
  serve(port=port, model_dir=model_dir, max_workers=max_workers).wait_for_termination()
