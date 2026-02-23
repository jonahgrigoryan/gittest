"""Button template loading and matching for the vision pipeline."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Dict, FrozenSet, Mapping, Optional, Tuple

import cv2
import numpy as np

from .fallback import _to_grayscale

LOGGER = logging.getLogger(__name__)

DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD = 0.8
DEFAULT_LAYOUT_PACKS_DIR = "/layout-packs"

TURN_INDICATOR_BUTTONS: FrozenSet[str] = frozenset({"fold", "call", "check", "raise"})

_UNSET = object()


class TemplateLoadError(Exception):
    """Raised when the layout pack JSON cannot be read or parsed."""


def _get_confidence_threshold() -> float:
    """Return the template match confidence threshold from env or default."""
    env_val = os.environ.get("VISION_TEMPLATE_CONFIDENCE_THRESHOLD")
    if env_val is not None:
        try:
            threshold = float(env_val)
            return max(0.0, min(threshold, 1.0))
        except ValueError:
            LOGGER.warning(
                "Invalid VISION_TEMPLATE_CONFIDENCE_THRESHOLD: %s, using default",
                env_val,
            )
    return DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD


@dataclass(slots=True)
class ButtonMatchResult:
    """Result of matching a single button template against an ROI image."""

    name: str
    confidence: float
    is_enabled: bool
    match_location: Tuple[int, int]
    screen_coords: Tuple[int, int]


class TemplateManager:
    """Load and cache button template images from layout pack assets.

    Templates are loaded at construction time from the layout pack JSON
    referenced by ``layout_pack_file`` (or the ``VISION_LAYOUT_PACK``
    environment variable).
    """

    def __init__(
        self,
        layout_pack_dir: Optional[str] = None,
        layout_pack_file: object = _UNSET,
    ) -> None:
        self._base_dir = layout_pack_dir or DEFAULT_LAYOUT_PACKS_DIR
        self._threshold = _get_confidence_threshold()
        self._templates: Dict[str, np.ndarray] = {}
        self._template_names: FrozenSet[str] = frozenset()

        if layout_pack_file is _UNSET:
            resolved_file = os.environ.get("VISION_LAYOUT_PACK")
        else:
            resolved_file = layout_pack_file  # type: ignore[assignment]
        self._layout_pack_file: Optional[str] = resolved_file
        self._load_startup_templates()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def threshold(self) -> float:
        return self._threshold

    @property
    def templates(self) -> Mapping[str, np.ndarray]:
        # Expose a read-only snapshot so callers cannot mutate the startup cache.
        return dict(self._templates)

    @property
    def template_names(self) -> FrozenSet[str]:
        return self._template_names

    @property
    def is_loaded(self) -> bool:
        return len(self._templates) > 0

    # ------------------------------------------------------------------
    # Startup loading
    # ------------------------------------------------------------------

    def _load_startup_templates(self) -> None:
        """Load button template images from the layout pack JSON.

        Raises ``TemplateLoadError`` when the layout pack JSON itself
        cannot be read or parsed.  Individual missing template images
        are logged and skipped (Req 5.6).
        """
        if self._layout_pack_file is None:
            LOGGER.warning("No VISION_LAYOUT_PACK configured; templates unavailable")
            return

        pack_path = os.path.join(self._base_dir, self._layout_pack_file)

        try:
            with open(pack_path, "r", encoding="utf-8") as fh:
                layout_data = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise TemplateLoadError(
                f"Cannot load layout pack from {pack_path}: {exc}"
            ) from exc

        button_templates_raw = layout_data.get("buttonTemplates", {})
        if not isinstance(button_templates_raw, dict):
            raise TemplateLoadError(
                f"Invalid buttonTemplates in {pack_path}: expected object"
            )

        button_templates: Dict[str, str] = {}
        for key, value in button_templates_raw.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise TemplateLoadError(
                    f"Invalid buttonTemplates entry in {pack_path}: {key!r} -> {value!r}"
                )
            button_templates[key] = value

        self._template_names = frozenset(button_templates.keys())

        loaded = 0
        for name, relative_path in button_templates.items():
            full_path = os.path.join(self._base_dir, relative_path)
            image = cv2.imread(full_path, cv2.IMREAD_COLOR)
            if image is None:
                LOGGER.error("Failed to load template '%s' from %s", name, full_path)
                continue
            self._templates[name] = image
            loaded += 1

        LOGGER.info("Loaded %d/%d button templates", loaded, len(button_templates))


# ------------------------------------------------------------------
# Template matching helpers
# ------------------------------------------------------------------


def match_template_with_location(
    image: np.ndarray, template: np.ndarray
) -> Tuple[float, Tuple[int, int]]:
    """Match *template* against *image* and return (confidence, location).

    Uses ``cv2.TM_CCOEFF_NORMED`` and ``cv2.minMaxLoc`` to find the
    highest-confidence match location (Req 5.4).
    """
    if template.size == 0 or image.size == 0:
        return 0.0, (0, 0)

    image_gray = _to_grayscale(image)
    template_gray = _to_grayscale(template)

    try:
        result = cv2.matchTemplate(image_gray, template_gray, cv2.TM_CCOEFF_NORMED)
    except cv2.error:
        return 0.0, (0, 0)

    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    confidence = max(0.0, min(float(max_val), 1.0))
    return confidence, max_loc


def match_button_templates(
    action_button_regions: Dict[str, Dict[str, object]],
    templates: Dict[str, np.ndarray],
    threshold: float = DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD,
) -> Dict[str, ButtonMatchResult]:
    """Match loaded templates against extracted action button ROI images.

    Only buttons whose confidence meets or exceeds *threshold* are
    included in the returned dict (Req 5.3 / 5.5).
    """
    results: Dict[str, ButtonMatchResult] = {}

    for button_name, region in action_button_regions.items():
        if button_name not in templates:
            continue

        roi_image = region["image"]
        template = templates[button_name]
        confidence, match_loc = match_template_with_location(roi_image, template)

        if confidence < threshold:
            continue

        roi = region["roi"]
        roi_x = int(round(float(roi["x"])))
        roi_y = int(round(float(roi["y"])))
        screen_coords = (roi_x + match_loc[0], roi_y + match_loc[1])

        results[button_name] = ButtonMatchResult(
            name=button_name,
            confidence=confidence,
            is_enabled=True,
            match_location=match_loc,
            screen_coords=screen_coords,
        )

    return results


def derive_turn_state(
    match_results: Dict[str, ButtonMatchResult],
) -> Tuple[bool, float]:
    """Derive turn state from button template presence (Req 5.7).

    Returns ``(is_hero_turn, confidence)``.  Hero's turn is True when
    at least one turn-indicator button (fold/call/check/raise) is
    present in *match_results*.
    """
    detected = [
        r for name, r in match_results.items() if name in TURN_INDICATOR_BUTTONS
    ]

    if not detected:
        return False, 0.0

    avg_confidence = sum(r.confidence for r in detected) / len(detected)
    return True, avg_confidence
