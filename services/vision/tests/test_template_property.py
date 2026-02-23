"""Property tests for template match confidence threshold (Task 8.4).

Property 16: For any template matching operation, only matches meeting
or exceeding the confidence threshold should appear in results, and
turn state should only be True when turn-indicator buttons are detected.
"""

from __future__ import annotations

import numpy as np
from hypothesis import given, settings
from hypothesis import strategies as st

from vision.templates import (
    derive_turn_state,
    match_button_templates,
)


def _uniform_image(color: int = 128) -> np.ndarray:
    return np.full((30, 50, 3), color, dtype=np.uint8)


def _make_regions_and_templates(
    button_names: list[str], image: np.ndarray
) -> tuple[dict, dict]:
    regions = {
        name: {
            "image": image,
            "roi": {"x": i * 100, "y": 0, "width": 50, "height": 30},
        }
        for i, name in enumerate(button_names)
    }
    templates = {name: image.copy() for name in button_names}
    return regions, templates


@given(threshold=st.floats(min_value=0.0, max_value=1.0))
@settings(max_examples=200)
def test_below_threshold_never_in_results(threshold: float) -> None:
    """Buttons with confidence < threshold never appear in results (Req 5.5)."""
    # Identical image + template → confidence ~1.0
    image = _uniform_image()
    regions, templates = _make_regions_and_templates(["fold"], image)

    results = match_button_templates(regions, templates, threshold=threshold)

    for name, result in results.items():
        assert result.confidence >= threshold, (
            f"Button {name} in results with confidence {result.confidence} "
            f"< threshold {threshold}"
        )


@given(threshold=st.floats(min_value=0.0, max_value=1.0))
@settings(max_examples=200)
def test_above_threshold_always_in_results(threshold: float) -> None:
    """Perfect-match buttons with confidence >= threshold are in results (Req 5.3)."""
    image = _uniform_image()
    regions, templates = _make_regions_and_templates(["fold"], image)

    results = match_button_templates(regions, templates, threshold=threshold)

    # A uniform image matched against itself has confidence ~1.0
    # so it should always be in results unless threshold is exactly 1.0
    # and floating point rounds the confidence below 1.0
    if threshold <= 0.99:
        assert "fold" in results


@given(
    n_buttons=st.integers(min_value=1, max_value=4),
    threshold=st.floats(min_value=0.01, max_value=0.99),
)
@settings(max_examples=200)
def test_turn_state_requires_detected_turn_buttons(
    n_buttons: int, threshold: float
) -> None:
    """Turn state True iff at least one turn-indicator button in results (Req 5.7)."""
    turn_names = ["fold", "check", "call", "raise"][:n_buttons]
    image = _uniform_image()
    regions, templates = _make_regions_and_templates(turn_names, image)

    results = match_button_templates(regions, templates, threshold=threshold)
    is_turn, _ = derive_turn_state(results)

    any_turn_button = any(
        name in results for name in {"fold", "call", "check", "raise"}
    )
    assert is_turn == any_turn_button
