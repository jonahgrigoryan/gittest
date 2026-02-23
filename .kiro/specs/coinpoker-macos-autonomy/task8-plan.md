Context
The vision service's _process_action_buttons currently uses occlusion heuristics to guess button visibility/enabled state. This must be replaced with OpenCV template matching against button images from layout packs. Template paths are declared in LayoutPack.buttonTemplates (e.g., "fold": "assets/templates/simulator/fold.png"). The work satisfies Requirements 5.1-5.7 and subtasks 8.1-8.5 from .kiro/specs/coinpoker-macos-autonomy/tasks.md.

Step 1: Add hypothesis dev dependency
File: services/vision/pyproject.toml
Change: Add hypothesis = "^6.100.0" under [tool.poetry.group.dev.dependencies]
Then: Run poetry lock && poetry install inside services/vision/
Req: 8.4 (property tests need hypothesis)

Step 2: Create templates.py (core module)
File: services/vision/src/vision/templates.py (NEW)
Relationship to fallback.py:

fallback.match_template() remains unchanged for existing card/dealer fallback paths.
match_template_with_location() in templates.py runs its own grayscale + cv2.matchTemplate call because it must return both confidence and max_loc.
So: no direct call to fallback.match_template() from match_template_with_location().
Contents:
Constants & helpers:

DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD = 0.8 (per design.md line 716)
DEFAULT_LAYOUT_PACKS_DIR = "/layout-packs" — hardcoded constant matching Docker volume mount in docker-compose.yml (not an env var)
_get_confidence_threshold() — reads VISION_TEMPLATE_CONFIDENCE_THRESHOLD env var, falls back to 0.8

Path resolution for startup loading (uses existing env contract only):

VISION_LAYOUT_PACK env var (e.g., simulator/default.layout.json) — already required by packages/shared/src/env/schema.ts line 76
Layout pack full path = os.path.join(layout_pack_dir, VISION_LAYOUT_PACK) → /layout-packs/simulator/default.layout.json
Reads the JSON file, extracts buttonTemplates dict
Template image paths are relative to layout_pack_dir (e.g., assets/templates/simulator/fold.png → /layout-packs/assets/templates/simulator/fold.png)
Production path convention for Task 9:

Store template PNGs under repo path config/layout-packs/assets/templates/<site>/... and reference them in layout JSON as assets/templates/<site>/...
In containers, config/layout-packs is mounted to /layout-packs, so runtime resolution stays /layout-packs/assets/templates/<site>/...
No new env vars introduced — only VISION_TEMPLATE_CONFIDENCE_THRESHOLD for threshold override

TemplateManager class:

__init__(layout_pack_dir: Optional[str] = None, layout_pack_file: Optional[str] = None):

layout_pack_dir defaults to DEFAULT_LAYOUT_PACKS_DIR ("/layout-packs")
layout_pack_file defaults to os.environ.get("VISION_LAYOUT_PACK")
Stores threshold from _get_confidence_threshold()
self._templates: Dict[str, np.ndarray] = {} — loaded template images
self._template_names: FrozenSet[str] = frozenset() — all template keys declared in layout pack (including ones that failed to load)
Calls self._load_startup_templates() immediately (Req 5.1: load at startup)
On JSON parse error or I/O error reading layout pack file: raises TemplateLoadError (new exception class in templates.py). Individual missing template images within a valid layout pack are non-fatal (Req 5.6).
This means: valid layout pack with some missing PNGs → succeeds with partial templates. Invalid/missing layout pack JSON → raises, caught by serve().


_load_startup_templates():

If layout_pack_file is None → log warning, return (no templates available)
Build full path: os.path.join(self._base_dir, layout_pack_file)
Read JSON, extract buttonTemplates dict
Store self._template_names = frozenset(buttonTemplates.keys()) — tracks which buttons have templates declared
For each (name, relative_path): resolve via os.path.join(self._base_dir, relative_path), load with cv2.imread
Missing file → LOGGER.error("Failed to load template '%s' from %s", name, full_path), skip, continue (Req 5.6)
Store successfully loaded images in self._templates
Log summary: LOGGER.info("Loaded %d/%d button templates", loaded, total)


threshold property → float
templates property → Dict[str, np.ndarray] (read-only access to loaded templates)
template_names property → FrozenSet[str] (all declared template keys, including failed loads)
is_loaded property → bool (True if at least one template loaded)

ButtonMatchResult dataclass (slots=True):

name: str, confidence: float, is_enabled: bool, match_location: Tuple[int, int] (pixel offset within ROI where best match was found), screen_coords: Tuple[int, int]
is_enabled is True when confidence >= threshold (button detected and actionable)
A ButtonMatchResult only appears in results when confidence >= threshold, so is_enabled is always True in the returned dict
This distinguishes from buttons that are absent from results (below threshold → omitted per Req 5.5)

match_template_with_location(image, template) function:

Wraps cv2.matchTemplate(gray_image, gray_template, cv2.TM_CCOEFF_NORMED)
Uses cv2.minMaxLoc(result) to get (min_val, max_val, min_loc, max_loc)
Returns Tuple[float, Tuple[int, int]] — (confidence, max_loc) (Req 5.4: location of highest confidence match)
Handles edge cases (empty image/template → (0.0, (0, 0)), cv2.error → (0.0, (0, 0)))

match_button_templates(action_button_regions, templates, threshold) function:

For each button in action_button_regions: if a matching template key exists in templates:

Call match_template_with_location(roi_image, template) → (confidence, match_loc)
If confidence >= threshold: include ButtonMatchResult in results with screen_coords computed as (roi_x + match_loc[0], roi_y + match_loc[1]) (Req 5.3)
If confidence < threshold: omit from results entirely (Req 5.5: return empty result for that button)


When multiple templates could match the same ROI (future extensibility), minMaxLoc inherently selects the highest confidence location (Req 5.4)
Returns Dict[str, ButtonMatchResult] — only contains buttons that exceeded threshold

derive_turn_state(match_results) function:

TURN_INDICATOR_BUTTONS = frozenset({"fold", "call", "check", "raise"})
Collect results where name in TURN_INDICATOR_BUTTONS (all results are already above threshold since below-threshold are omitted)
If any: is_hero_turn=True, confidence = mean of detected confidences
If none: is_hero_turn=False, confidence = 0.0
Returns Tuple[bool, float] (Req 5.7)


Step 3: Update __init__.py exports
File: services/vision/src/vision/__init__.py
Change: Add import from .templates and __all__ entries for TemplateManager, TemplateLoadError, ButtonMatchResult, match_button_templates, match_template_with_location, derive_turn_state, DEFAULT_TEMPLATE_CONFIDENCE_THRESHOLD

Step 4: Integrate into server.py
File: services/vision/src/vision/server.py
4a. Add TemplateManager to VisionServicer.__init__

New optional kwarg: template_manager: Optional[TemplateManager] = None
Default: self._template_manager = template_manager or TemplateManager()
Import from .templates: TemplateManager, TemplateLoadError, match_button_templates, derive_turn_state

4b. Update CaptureFrame (lines 40-70)
No layout-pack parsing changes needed for template loading — templates are already loaded at startup. Pass self._template_manager.templates to _process_action_buttons:
self._process_action_buttons(
    elements.get("actionButtons", {}),
    builder,
    self._template_manager.templates,
)
4c. Refactor _process_action_buttons (lines 163-183)
New signature: (self, buttons, builder, templates: Dict[str, np.ndarray])
When templates are non-empty:

Call match_button_templates(buttons, templates, self._template_manager.threshold) → match_results
For each button in buttons:

Normalize allIn/all_in → all_in for proto name
Case A — button detected (name in match_results): build button_info with is_enabled=True, is_visible=True, confidence from match, screen_coords from match location, text=raw_name. Call builder.set_action_button(). (Req 5.3)
Case B — button has no template declared (name not in self._template_manager.template_names, e.g., "bet"): fall back to occlusion heuristic (current behavior). Call builder.set_action_button().
Case C — template exists but confidence below threshold (name in template_names but not in match_results): do not call builder.set_action_button — button is omitted from output entirely (Req 5.5)


Call derive_turn_state(match_results) and map explicitly to builder.set_turn_state:

is_hero_turn, turn_confidence = derive_turn_state(match_results)
builder.set_turn_state(
    is_hero_turn=is_hero_turn,
    action_timer=0,  # unknown in template-matching MVP
    confidence=turn_confidence,
)
(Req 5.7)

Enabled/disabled semantics for downstream (executor):

The executor's isButtonActionable() (packages/executor/src/window_manager.ts:253) checks isEnabled && isVisible && confidence >= minConfidence
Detected buttons (Case A): isEnabled=true → executor treats as clickable
Omitted buttons (Case C): absent from actionButtons → executor's findActionButton() returns null → executor won't attempt to click
This is consistent with Req 5.5 ("return empty result") and Req 5.7 (turn state derived only from detected buttons)
"Disabled" in the sense of "greyed out button visible on screen" is not a separate state in the template matching MVP — a button is either detected (enabled) or not detected (omitted). This is acceptable because CoinPoker renders disabled buttons as visually distinct (different appearance), so they won't match the enabled-state template above threshold.

Executor compatibility note (Task 7 / research_bridge.ts):

selectActionButton() (line 454) returns { state: "missing" } for absent buttons and { state: "disabled" } for present but non-actionable buttons.
Both states result in createFailureResult() — neither is clickable. The only difference is log level: error for missing, warn for disabled.
With omission semantics, a below-threshold button produces "missing" state. This is functionally correct — the executor won't click it. The error log level is actually appropriate since the strategy requested an action that the vision system couldn't detect.
This does NOT violate Task 7 expectations. The executor's execute() flow (line 164) calls captureVisionSnapshot() → isHeroTurn() → selectActionButton(). If vision omits a button, the executor correctly refuses to act, which is the desired safety behavior.

When templates are empty (no templates loaded): preserve current occlusion-only behavior (fallback path).
4d. Update serve() function (line 274)

Add optional layout_pack_dir parameter (for testing; defaults to "/layout-packs" constant)
Create TemplateManager(layout_pack_dir=layout_pack_dir) — it reads VISION_LAYOUT_PACK from env internally
Wrap TemplateManager(...) in try/except TemplateLoadError: on failure, log error, create fallback TemplateManager(layout_pack_file=None), set ready=False on servicer
Pass to VisionServicer
No new env vars — uses existing VISION_LAYOUT_PACK from env/.env.vision

4e. Add HealthCheck readiness gate

Add ready: bool = True kwarg to VisionServicer.__init__
Store as self._ready = ready
Update HealthCheck to:

return vision_pb2.HealthStatus(
    healthy=self._ready,
    message="ready" if self._ready else "not ready"
)

Real failure scenario in serve(): Wrap TemplateManager(...) construction in try/except TemplateLoadError. On failure:

Log error with full traceback
Create TemplateManager with layout_pack_file=None (produces empty templates, no exception)
Create VisionServicer(..., ready=False)
Still start the server (allows health check to report unhealthy while the container is running — useful for container orchestration health probes)


This is consistent: TemplateManager raises TemplateLoadError on layout pack JSON failures (not on individual missing PNGs per Req 5.6), and serve() catches it to produce an unhealthy servicer
(Task 8.3a)


Step 5: Create test files
5a. tests/conftest.py (NEW)
Shared fixtures: sample_roi_image (30x50 BGR np.ndarray), sample_template (copy of ROI image)
5b. tests/test_templates.py (NEW) — Task 8.5
TestTemplateManager (Reqs 5.1, 5.6):

test_load_templates_at_startup — create tmp_path with layout JSON + template PNGs, pass as layout_pack_dir + layout_pack_file, verify manager.templates has loaded images (Req 5.1)
test_missing_template_logs_error_and_continues — layout JSON references a file that doesn't exist, verify partial load + error in caplog (Req 5.6)
test_no_layout_pack_file_produces_empty_templates — layout_pack_file=None, verify manager.templates == {}
test_is_loaded_property — True when templates exist, False when empty
test_threshold_from_environment — patch.dict(os.environ, {"VISION_TEMPLATE_CONFIDENCE_THRESHOLD": "0.75"}), verify manager.threshold == 0.75
test_default_threshold — verify 0.8 default

TestMatchTemplateWithLocation (Req 5.4):

test_returns_confidence_and_location — identical image/template → confidence near 1.0, location at (0,0)
test_highest_confidence_location_selected — embed a small distinctive pattern at a known offset in a larger image, verify max_loc points to that offset
test_empty_image_returns_zero — empty ndarray → (0.0, (0, 0))

TestMatchButtonTemplates (Reqs 5.2-5.5):

test_returns_match_above_threshold — identical image/template → button in results with is_enabled=True and correct screen_coords (Req 5.3)
test_omits_button_below_threshold — random noise images, threshold=0.999 → button key not in results (empty result) (Req 5.5)
test_no_template_for_button_skips_it — button key not in templates dict → not in results
test_screen_coords_include_match_offset — verify screen_coords = roi_origin + match_location (Req 5.4)
test_detected_buttons_always_enabled — all buttons in results have is_enabled=True (detected = enabled in MVP)

TestDeriveTurnState (Req 5.7):

test_hero_turn_when_buttons_detected — fold+call in results → is_hero_turn=True
test_not_hero_turn_when_no_results — empty results → False
test_non_turn_indicator_buttons_ignored — only allIn+bet in results → False
test_empty_results_not_hero_turn

5c. tests/test_template_property.py (NEW) — Task 8.4
Using hypothesis:

test_below_threshold_never_in_results — for any threshold in [0,1], buttons with confidence < threshold are never in results (Req 5.5)
test_above_threshold_always_in_results — for any threshold in [0,1], buttons with confidence >= threshold are always in results (Req 5.3)
test_turn_state_requires_detected_turn_buttons — turn state is True iff at least one turn-indicator button key exists in results (Req 5.7)

5d. tests/test_health_check.py (NEW) — Task 8.3a
Success path:

test_health_check_returns_healthy — construct VisionServicer normally (mock ModelManager + TemplateManager) → HealthCheck returns healthy=True, message="ready"
test_health_check_does_not_abort — context.abort not called

Failure path:

test_health_check_returns_unhealthy_when_not_ready — construct VisionServicer(model_manager, ready=False) → HealthCheck returns healthy=False, message="not ready" (tests the ready kwarg contract directly)
test_serve_with_bad_layout_pack_starts_unhealthy — real server test (no mocks): set VISION_LAYOUT_PACK to a nonexistent file, start serve(layout_pack_dir=tmp_path, port=<free localhost port>), call HealthCheck via gRPC VisionServiceStub, assert healthy=False/message="not ready", then stop server in finally (verifies real runtime failure path end-to-end without hanging)

Uses MagicMock(spec=ModelManager) for VisionServicer construction.

Verification

cd services/vision && poetry install
poetry run pytest tests/ -v — all tests pass
poetry run ruff check src/ tests/ — no lint errors
poetry run black --check src/ tests/ — formatting OK
Verify test_output.py (existing test) still passes — no regressions


Key Design Decisions
DecisionChoiceRationaleNew module vs extend fallback.pyNew templates.pySeparation of concerns; fallback.py is card/digit fallbacksTemplate path resolutionExisting VISION_LAYOUT_PACK env var + /layout-packs hardcoded base dirReuses existing env contract from env/.env.vision and packages/shared/src/env/schema.ts; no new env vars for pathConfidence threshold0.8 default, VISION_TEMPLATE_CONFIDENCE_THRESHOLD env overridePer design.md; distinct from bot config's 0.9 overall threshold; only new env var introducedLoading strategyAt startup in TemplateManager.__init__Satisfies Req 5.1 ("load on startup"); uses VISION_LAYOUT_PACK to find layout JSONBelow-threshold behaviorOmit button from results entirelySatisfies Req 5.5 ("return empty result for that button")Enabled/disabled semanticsDetected = enabled; not detected = omitted (not present in output)Executor's isButtonActionable() requires isEnabled && isVisible; omitted buttons → findActionButton() returns null. CoinPoker renders disabled buttons differently so they won't match enabled-state templates above threshold. No separate "disabled" state needed in MVP.Match locationcv2.minMaxLoc on matchTemplate resultSatisfies Req 5.4 (highest confidence match + location); current fallback.match_template only returns confidenceHealth check readiness_ready flag with real failure path in serve()serve() catches TemplateManager/ModelManager init failures and starts servicer with ready=False; enables meaningful health probe (Task 8.3a)Fallback when no templatesPreserve occlusion heuristicBackward compatibility; graceful degradation

Files Summary
FileActionPurposeservices/vision/pyproject.tomlMODIFYAdd hypothesis dev depservices/vision/src/vision/templates.pyCREATETemplateManager, TemplateLoadError, match_template_with_location, match_button_templates, derive_turn_state, ButtonMatchResultservices/vision/src/vision/server.pyMODIFYAdd TemplateManager dep, refactor _process_action_buttons, add _ready flag to HealthCheck, update serve()services/vision/src/vision/__init__.pyMODIFYExport new symbols from .templatesservices/vision/tests/conftest.pyCREATEShared test fixturesservices/vision/tests/test_templates.pyCREATEUnit tests for template loading + matching (Task 8.5)services/vision/tests/test_template_property.pyCREATEProperty tests for confidence threshold (Task 8.4)services/vision/tests/test_health_check.pyCREATEHealth check success + failure tests (Task 8.3a)
