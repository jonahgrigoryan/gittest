"""Unit tests for template loading and matching (Task 8.5)."""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from vision.templates import (
    DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD,
    ButtonMatchResult,
    TemplateLoadError,
    TemplateManager,
    derive_turn_state,
    match_button_templates,
    match_template_with_location,
)


def _create_image(width: int = 50, height: int = 30, color: int = 128) -> np.ndarray:
    """Create a simple BGR test image."""
    return np.full((height, width, 3), color, dtype=np.uint8)


def _write_layout_json(path, button_templates: dict[str, str] | None = None) -> None:
    """Write a minimal layout pack JSON with optional buttonTemplates."""
    layout = {
        "version": "1.0.0",
        "platform": "test",
        "theme": "default",
        "resolution": {"width": 1920, "height": 1080},
    }
    if button_templates is not None:
        layout["buttonTemplates"] = button_templates
    path.write_text(json.dumps(layout))


# ---------------------------------------------------------------
# TestTemplateManager  (Reqs 5.1, 5.6)
# ---------------------------------------------------------------


class TestTemplateManager:
    """Tests for TemplateManager startup loading."""

    def test_load_templates_at_startup(self, tmp_path: object) -> None:
        """Templates load from layout pack directory at construction (Req 5.1)."""
        templates_dir = tmp_path / "assets"
        templates_dir.mkdir(parents=True)

        fold_img = _create_image(color=100)
        check_img = _create_image(color=150)
        cv2.imwrite(str(templates_dir / "fold.png"), fold_img)
        cv2.imwrite(str(templates_dir / "check.png"), check_img)

        layout_file = tmp_path / "test.layout.json"
        _write_layout_json(
            layout_file,
            {"fold": "assets/fold.png", "check": "assets/check.png"},
        )

        manager = TemplateManager(
            layout_pack_dir=str(tmp_path), layout_pack_file="test.layout.json"
        )

        assert "fold" in manager.templates
        assert "check" in manager.templates
        assert manager.templates["fold"].shape == fold_img.shape
        assert manager.is_loaded is True

    def test_missing_template_logs_error_and_continues(
        self, tmp_path: object, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Missing template images log error and continue (Req 5.6)."""
        templates_dir = tmp_path / "assets"
        templates_dir.mkdir(parents=True)

        fold_img = _create_image()
        cv2.imwrite(str(templates_dir / "fold.png"), fold_img)

        layout_file = tmp_path / "test.layout.json"
        _write_layout_json(
            layout_file,
            {"fold": "assets/fold.png", "check": "assets/check.png"},
        )

        with caplog.at_level("ERROR"):
            manager = TemplateManager(
                layout_pack_dir=str(tmp_path), layout_pack_file="test.layout.json"
            )

        assert "fold" in manager.templates
        assert "check" not in manager.templates
        assert "Failed to load template" in caplog.text
        assert manager.template_names == frozenset({"fold", "check"})

    def test_no_layout_pack_file_produces_empty_templates(self) -> None:
        """No layout pack file configured produces empty templates."""
        manager = TemplateManager(layout_pack_file=None)
        assert manager.templates == {}
        assert manager.is_loaded is False

    def test_is_loaded_property(self, tmp_path: object) -> None:
        """is_loaded reflects whether any template was loaded."""
        templates_dir = tmp_path / "assets"
        templates_dir.mkdir(parents=True)
        cv2.imwrite(str(templates_dir / "fold.png"), _create_image())

        layout_file = tmp_path / "test.layout.json"
        _write_layout_json(layout_file, {"fold": "assets/fold.png"})

        loaded = TemplateManager(
            layout_pack_dir=str(tmp_path), layout_pack_file="test.layout.json"
        )
        empty = TemplateManager(layout_pack_file=None)

        assert loaded.is_loaded is True
        assert empty.is_loaded is False

    def test_threshold_from_environment(self) -> None:
        """Threshold reads from VISION_TEMPLATE_CONFIDENCE_THRESHOLD."""
        with patch.dict(os.environ, {"VISION_TEMPLATE_CONFIDENCE_THRESHOLD": "0.75"}):
            manager = TemplateManager(layout_pack_file=None)
            assert manager.threshold == 0.75

    def test_default_threshold(self) -> None:
        """Default threshold is 0.8."""
        env = os.environ.copy()
        env.pop("VISION_TEMPLATE_CONFIDENCE_THRESHOLD", None)
        with patch.dict(os.environ, env, clear=True):
            manager = TemplateManager(layout_pack_file=None)
            assert manager.threshold == DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD

    def test_invalid_layout_json_raises(self, tmp_path: object) -> None:
        """Malformed layout pack JSON raises TemplateLoadError."""
        bad_file = tmp_path / "bad.layout.json"
        bad_file.write_text("{not valid json")

        with pytest.raises(TemplateLoadError):
            TemplateManager(
                layout_pack_dir=str(tmp_path), layout_pack_file="bad.layout.json"
            )

    def test_missing_layout_file_raises(self, tmp_path: object) -> None:
        """Non-existent layout pack file raises TemplateLoadError."""
        with pytest.raises(TemplateLoadError):
            TemplateManager(
                layout_pack_dir=str(tmp_path),
                layout_pack_file="does_not_exist.json",
            )

    def test_invalid_button_templates_type_raises(self, tmp_path: object) -> None:
        """Non-object buttonTemplates value raises TemplateLoadError."""
        layout_file = tmp_path / "test.layout.json"
        layout_file.write_text(
            json.dumps(
                {
                    "version": "1.0.0",
                    "platform": "test",
                    "theme": "default",
                    "resolution": {"width": 1920, "height": 1080},
                    "buttonTemplates": ["fold.png"],
                }
            )
        )

        with pytest.raises(TemplateLoadError):
            TemplateManager(
                layout_pack_dir=str(tmp_path),
                layout_pack_file="test.layout.json",
            )


# ---------------------------------------------------------------
# TestMatchTemplateWithLocation  (Req 5.4)
# ---------------------------------------------------------------


class TestMatchTemplateWithLocation:
    """Tests for match_template_with_location."""

    def test_returns_confidence_and_location(self) -> None:
        """Identical image/template yields confidence near 1.0 at (0,0)."""
        image = _create_image(50, 30, 128)
        template = image.copy()

        confidence, location = match_template_with_location(image, template)

        assert confidence >= 0.99
        assert location == (0, 0)

    def test_highest_confidence_location_selected(self) -> None:
        """Distinctive pattern at known offset → max_loc matches."""
        # Use a textured template so TM_CCOEFF_NORMED has variance to work with
        rng = np.random.RandomState(123)
        template = rng.randint(0, 255, (20, 30, 3), dtype=np.uint8)

        # Embed the textured template in a larger noisy background at (80, 40)
        image = rng.randint(50, 60, (100, 200, 3), dtype=np.uint8)
        image[40:60, 80:110] = template

        confidence, location = match_template_with_location(image, template)

        assert confidence > 0.9
        assert location == (80, 40)

    def test_empty_image_returns_zero(self) -> None:
        """Empty arrays return (0.0, (0, 0))."""
        empty = np.array([], dtype=np.uint8)
        template = _create_image()

        confidence, location = match_template_with_location(empty, template)

        assert confidence == 0.0
        assert location == (0, 0)


# ---------------------------------------------------------------
# TestMatchButtonTemplates  (Reqs 5.2-5.5)
# ---------------------------------------------------------------


class TestMatchButtonTemplates:
    """Tests for match_button_templates."""

    def test_returns_match_above_threshold(self) -> None:
        """Button returned when confidence exceeds threshold (Req 5.3)."""
        image = _create_image(50, 30, 128)
        template = image.copy()

        regions = {
            "fold": {
                "image": image,
                "roi": {"x": 100, "y": 200, "width": 50, "height": 30},
            },
        }
        templates = {"fold": template}

        results = match_button_templates(regions, templates, threshold=0.5)

        assert "fold" in results
        assert results["fold"].is_enabled is True
        assert results["fold"].confidence >= 0.5

    def test_omits_button_below_threshold(self) -> None:
        """Button not in results when below threshold (Req 5.5)."""
        rng = np.random.RandomState(42)
        image = rng.randint(0, 255, (30, 50, 3), dtype=np.uint8)
        template = rng.randint(0, 255, (30, 50, 3), dtype=np.uint8)

        regions = {
            "fold": {
                "image": image,
                "roi": {"x": 100, "y": 200, "width": 50, "height": 30},
            },
        }
        templates = {"fold": template}

        results = match_button_templates(regions, templates, threshold=0.999)

        assert "fold" not in results

    def test_no_template_for_button_skips_it(self) -> None:
        """Button without matching template is not in results."""
        image = _create_image()
        regions = {
            "bet": {
                "image": image,
                "roi": {"x": 100, "y": 200, "width": 50, "height": 30},
            },
        }
        templates = {"fold": _create_image()}

        results = match_button_templates(regions, templates, threshold=0.5)

        assert "bet" not in results

    def test_screen_coords_include_match_offset(self) -> None:
        """screen_coords equals roi origin plus match location (Req 5.4)."""
        # Use textured template so TM_CCOEFF_NORMED produces correct location
        rng = np.random.RandomState(99)
        template = rng.randint(0, 255, (20, 30, 3), dtype=np.uint8)

        # Embed at offset (10, 5) within a larger noisy search image
        search = rng.randint(50, 60, (50, 80, 3), dtype=np.uint8)
        search[5:25, 10:40] = template

        regions = {
            "fold": {
                "image": search,
                "roi": {"x": 100, "y": 200, "width": 80, "height": 50},
            },
        }
        templates = {"fold": template}

        results = match_button_templates(regions, templates, threshold=0.5)

        assert "fold" in results
        # screen_coords = roi_origin (100, 200) + match_loc (10, 5)
        assert results["fold"].screen_coords == (110, 205)

    def test_detected_buttons_always_enabled(self) -> None:
        """All buttons in results have is_enabled=True."""
        image = _create_image(50, 30, 128)
        template = image.copy()

        regions = {
            name: {
                "image": image,
                "roi": {"x": i * 100, "y": 0, "width": 50, "height": 30},
            }
            for i, name in enumerate(["fold", "check", "call"])
        }
        templates = {name: template.copy() for name in ["fold", "check", "call"]}

        results = match_button_templates(regions, templates, threshold=0.5)

        for name, result in results.items():
            assert result.is_enabled is True, f"{name} should be enabled"


# ---------------------------------------------------------------
# TestDeriveTurnState  (Req 5.7)
# ---------------------------------------------------------------


class TestDeriveTurnState:
    """Tests for derive_turn_state."""

    def test_hero_turn_when_buttons_detected(self) -> None:
        """Turn state True when fold/call detected."""
        results = {
            "fold": ButtonMatchResult("fold", 0.95, True, (0, 0), (100, 200)),
            "call": ButtonMatchResult("call", 0.90, True, (0, 0), (200, 200)),
        }
        is_turn, conf = derive_turn_state(results)
        assert is_turn is True
        assert conf == pytest.approx(0.925, abs=0.01)

    def test_not_hero_turn_when_no_results(self) -> None:
        """Turn state False when no results."""
        is_turn, conf = derive_turn_state({})
        assert is_turn is False
        assert conf == 0.0

    def test_non_turn_indicator_buttons_ignored(self) -> None:
        """allIn and bet do not affect turn state."""
        results = {
            "allIn": ButtonMatchResult("allIn", 0.99, True, (0, 0), (100, 200)),
            "bet": ButtonMatchResult("bet", 0.95, True, (0, 0), (200, 200)),
        }
        is_turn, conf = derive_turn_state(results)
        assert is_turn is False

    def test_empty_results_not_hero_turn(self) -> None:
        """Empty match results means not hero's turn."""
        is_turn, conf = derive_turn_state({})
        assert is_turn is False
        assert conf == 0.0
