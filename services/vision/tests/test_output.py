from vision.output import VisionOutputBuilder


def test_builder_produces_snake_case_payload() -> None:
  builder = VisionOutputBuilder()
  builder.set_cards(
    [{"rank": "A", "suit": "s"}, {"rank": "K", "suit": "d"}],
    [{"rank": "2", "suit": "c"}],
    0.95
  )
  builder.set_stack("BTN", 100.0, 0.9)
  builder.set_pot(5.0, 0.8)
  builder.set_buttons("BTN", 0.7)
  builder.set_positions(0.6)
  builder.set_occlusion("hero_cards", 0.1)
  builder.set_action_button(
    "fold",
    {
      "screen_coords": (100, 200),
      "is_enabled": True,
      "is_visible": True,
      "confidence": 0.9,
      "text": "Fold"
    }
  )
  builder.set_turn_state(is_hero_turn=True, action_timer=15, confidence=0.5)

  builder.mark_capture_complete()
  builder.mark_extraction_complete()

  payload = builder.build()

  assert payload["cards"]["hole_cards"][0]["rank"] == "A"
  assert payload["action_buttons"]["fold"]["screen_coords"] == (100, 200)
  assert payload["turn_state"]["is_hero_turn"] is True
