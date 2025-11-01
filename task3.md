# Task 3 — Vision System and Game State Parser Implementation

**Goal**: Implement a complete vision system that captures poker game state from screen, extracts elements using ONNX models, computes confidence scores, detects occlusions, parses game state, and implements SafeAction fallback policy.

**Architecture**: Python vision service (gRPC) + TypeScript client in orchestrator + shared types

---

## Prerequisites

- Task 1 and Task 2 completed
- Python 3.11.9 with poetry installed
- ONNX Runtime available
- Screen capture libraries available (platform-specific)

---

## 3.1 Create Layout Pack System

### 3.1.1 Define LayoutPack JSON Schema

**File**: `config/schema/layout-pack.schema.json`

Create JSON Schema with:
- `version` (string, required): semantic version for cache invalidation
- `platform` (string, required): identifier like "pokerstars", "ggpoker", "simulator"
- `theme` (string, required): "default", "dark", "classic", etc.
- `resolution` (object, required): `{ width: number, height: number }`
- `dpiCalibration` (number, required): base DPI multiplier (1.0, 1.5, 2.0)
- `cardROIs` (array, required): ROI definitions for hero and community cards
- `stackROIs` (object, required): mapping of Position to ROI for each player stack
- `potROI` (object, required): ROI for pot amount
- `buttonROI` (object, required): ROI for dealer button
- `actionButtonROIs` (object, required): ROIs for action buttons
  - `fold` (ROI, required)
  - `check` (ROI, required)
  - `call` (ROI, required)
  - `raise` (ROI, required)
  - `bet` (ROI, required)
  - `allIn` (ROI, required)
- `turnIndicatorROI` (object, required): ROI for detecting hero's turn
- `windowPatterns` (object, required): window detection metadata
  - `titleRegex` (string, required): regex to match window title
  - `processName` (string, required): process name to validate
  - `className` (string, optional): window class name (platform-specific)
- `buttonTemplates` (object, optional): paths to template images for button detection
  - `fold` (string): path to fold button template
  - `check` (string): path to check button template
  - `call` (string): path to call button template
  - `raise` (string): path to raise button template
  - `allIn` (string): path to all-in button template

Each ROI object: `{ x: number, y: number, width: number, height: number, relative?: boolean }`
- `relative` (boolean, optional): if true, coordinates are relative to window bounds (0-1 range)

**Validation rules**:
- All coordinates must be non-negative
- Width and height must be positive
- If relative=false or undefined, coordinates must be within resolution bounds
- If relative=true, coordinates must be in [0, 1] range

### 3.1.2 Create TypeScript LayoutPack Types

**File**: `packages/shared/src/vision/types.ts`

```typescript
import type { Position, Card } from '../types';

export interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
  relative?: boolean;  // true if coordinates are relative to window bounds
}

export interface ScreenCoords {
  x: number;
  y: number;
}

export interface ButtonInfo {
  screenCoords: ScreenCoords;
  isEnabled: boolean;
  isVisible: boolean;
  confidence: number;
  text?: string;  // button label if detected
}

export interface LayoutPack {
  version: string;
  platform: string;
  theme: string;
  resolution: { width: number; height: number };
  dpiCalibration: number;
  cardROIs: ROI[];
  stackROIs: Record<Position, ROI>;
  potROI: ROI;
  buttonROI: ROI;
  actionButtonROIs: {
    fold: ROI;
    check: ROI;
    call: ROI;
    raise: ROI;
    bet: ROI;
    allIn: ROI;
  };
  turnIndicatorROI: ROI;
  windowPatterns: {
    titleRegex: string;
    processName: string;
    className?: string;
  };
  buttonTemplates?: {
    fold?: string;
    check?: string;
    call?: string;
    raise?: string;
    allIn?: string;
  };
}

export interface VisionOutput {
  timestamp: number;
  cards: {
    holeCards: Card[];
    communityCards: Card[];
    confidence: number;
  };
  stacks: Map<Position, { amount: number; confidence: number }>;
  pot: { amount: number; confidence: number };
  buttons: { dealer: Position; confidence: number };
  positions: { confidence: number };  // confidence in position assignments
  occlusion: Map<string, number>;  // percentage occluded per ROI name
  
  // Action buttons for research UI mode
  actionButtons?: {
    fold?: ButtonInfo;
    check?: ButtonInfo;
    call?: ButtonInfo;
    raise?: ButtonInfo;
    bet?: ButtonInfo;
    allIn?: ButtonInfo;
  };
  
  // Turn state detection for research UI mode
  turnState?: {
    isHeroTurn: boolean;
    actionTimer?: number;  // seconds remaining
    confidence: number;
  };
  
  latency: {
    capture: number;
    extraction: number;
    total: number;
  };
}
```

### 3.1.3 Implement LayoutPack Loader (TypeScript)

**File**: `packages/shared/src/vision/layout-loader.ts`

Implement:
- `loadLayoutPack(filePath: string): LayoutPack`
  - Read JSON file
  - Validate against schema using Ajv
  - Throw detailed errors on validation failure
  - Return typed LayoutPack

- `validateLayoutPack(pack: unknown): ValidationResult`
  - Non-throwing validation
  - Return `{ valid: boolean, errors?: string[] }`

### 3.1.4 Create Sample Layout Packs

**Files**: 
- `config/layout-packs/simulator/default.layout.json`
- `config/layout-packs/research-ui/pokerstars-classic.layout.json` (optional)

Create at least one complete layout pack for simulator with:
- All ROI coordinates defined (cardROIs, stackROIs, potROI, buttonROI, actionButtonROIs, turnIndicatorROI)
- Version "1.0.0"
- Platform "simulator"
- Theme "default"
- Resolution 1920x1080
- DPI calibration 1.0
- Window patterns for simulator process
- All six action button ROIs (fold, check, call, raise, bet, allIn)

### 3.1.5 Add DPI Calibration Utility

**File**: `packages/shared/src/vision/calibration.ts`

Implement:
- `scaleROI(roi: ROI, scale: number): ROI`
  - Multiply x, y, width, height by scale factor
  - Round to integers

- `calibrateLayoutPack(pack: LayoutPack, targetDPI: number): LayoutPack`
  - Calculate scale factor: `targetDPI / pack.dpiCalibration`
  - Scale all ROIs in regions
  - Update `dpiCalibration` to `targetDPI`
  - Return new LayoutPack

---

## 3.2 Implement Frame Capture and Element Extraction

### 3.2.1 Set Up Python Vision Service Structure

**Directory**: `services/vision/src/`

Create files:
- `__init__.py`
- `capture.py` - screen capture
- `extraction.py` - ROI extraction
- `models.py` - ONNX model loading and inference
- `server.py` - gRPC server
- `types.py` - Python type definitions

### 3.2.2 Implement Screen Capture

**File**: `services/vision/src/capture.py`

Implement class `ScreenCapture`:
- `__init__(self, window_title: Optional[str] = None)`
  - Initialize capture backend (platform-specific)
  - Store window title for filtering

- `capture_frame(self) -> np.ndarray`
  - Capture full screen or specific window
  - Return as numpy array (RGB format)
  - Handle errors gracefully

Platform-specific implementations:
- macOS: Use `screencapture` or `Quartz`
- Linux: Use `python-xlib` or `scrot`
- Windows: Use `mss` or `pywin32`

### 3.2.3 Implement ROI Extraction

**File**: `services/vision/src/extraction.py`

Implement:
- `extract_roi(frame: np.ndarray, roi: dict) -> np.ndarray`
  - Extract subregion from frame using ROI coordinates
  - Validate bounds
  - Return cropped image

- `extract_all_rois(frame: np.ndarray, layout: dict) -> dict`
  - Extract all ROIs defined in layout pack
  - Return dictionary mapping element name to cropped image
  - Track extraction time per element

### 3.2.4 Download/Create ONNX Models

**Directory**: `services/vision/models/`

Required models:
- `card_rank.onnx` - CNN for card rank recognition (13 classes: 2-A)
- `card_suit.onnx` - CNN for card suit recognition (4 classes: h,d,c,s)
- `digit.onnx` - CNN for stack digit recognition (11 classes: 0-9 + decimal)

Options:
1. Train simple CNNs on synthetic poker card/digit images
2. Use pre-trained models and fine-tune
3. Start with template matching as baselinee

Model requirements:
- Input: 64x64 RGB image (normalized 0-1)
- Output: softmax probabilities over classes
- ONNX opset 13+

### 3.2.5 Implement ONNX Model Loader

**File**: `services/vision/src/models.py`

Implement class `ModelManager`:
- `__init__(self, model_dir: str)`
  - Store model directory path
  - Initialize empty model cache

- `preload_models(self) -> None`
  - Load all ONNX models into memory
  - Create InferenceSession for each model
  - Warm up sessions with dummy inputs
  - Track loading time

- `predict_card_rank(self, image: np.ndarray) -> tuple[str, float]`
  - Preprocess image (resize, normalize)
  - Run inference
  - Return (rank, confidence)

- `predict_card_suit(self, image: np.ndarray) -> tuple[str, float]`
  - Similar to rank prediction
  - Return (suit, confidence)

- `predict_digits(self, image: np.ndarray) -> tuple[str, float]`
  - Run digit recognition
  - Handle multi-digit sequences
  - Return (number_string, confidence)

### 3.2.6 Implement Template Matching Fallback

**File**: `services/vision/src/fallback.py`

Implement:
- `match_template(image: np.ndarray, template: np.ndarray) -> float`
  - Use OpenCV template matching
  - Return match confidence (0-1)

- `recognize_card_template(image: np.ndarray, templates: dict) -> tuple[str, str, float]`
  - Match against all card templates
  - Return (rank, suit, confidence)

- `recognize_digits_ocr(image: np.ndarray) -> tuple[str, float]`
  - Use simple OCR (pytesseract or custom)
  - Return (text, confidence)

### 3.2.7 Implement Element Recognizer

**File**: `services/vision/src/extraction.py` (extend)

Implement class `ElementRecognizer`:
- `__init__(self, model_manager: ModelManager, use_fallback: bool = True)`

- `recognize_card(self, image: np.ndarray) -> dict`
  - Try ONNX models first
  - Fall back to template matching if confidence < 0.8
  - Return `{ rank: str, suit: str, confidence: float, method: str }`

- `recognize_stack(self, image: np.ndarray) -> dict`
  - Recognize digits using ONNX
  - Parse as float (handle decimals, commas)
  - Return `{ amount: float, confidence: float }`

- `recognize_pot(self, image: np.ndarray) -> dict`
  - Similar to stack recognition
  - Return `{ amount: float, confidence: float }`

- `detect_dealer_button(self, image: np.ndarray) -> dict`
  - Use template matching or color detection
  - Return `{ present: bool, confidence: float }`

---

## 3.3 Add Confidence Scoring and Occlusion Detection

### 3.3.1 Implement Per-Element Confidence Calculation

**File**: `services/vision/src/confidence.py`

Implement:
- `calculate_match_confidence(prediction_probs: np.ndarray) -> float`
  - Use max probability from softmax output
  - Apply calibration if needed
  - Return confidence in [0, 1]

- `aggregate_confidence(confidences: list[float]) -> float`
  - Compute geometric mean or minimum
  - Return overall confidence

### 3.3.2 Implement Occlusion Detection

**File**: `services/vision/src/occlusion.py`

Implement:
- `detect_occlusion(image: np.ndarray, roi: dict) -> tuple[bool, float]`
  - Calculate pixel variance in ROI
  - Check for uniform colors (likely overlay/popup)
  - Detect unexpected patterns
  - Return (is_occluded, occlusion_score)

- `analyze_roi_variance(image: np.ndarray) -> float`
  - Compute standard deviation of pixel values
  - Low variance indicates potential occlusion
  - Return variance score

- `detect_popup_overlay(image: np.ndarray) -> bool`
  - Look for common popup patterns
  - Check for semi-transparent overlays
  - Return True if popup detected

### 3.3.3 Create VisionOutput Builder

**File**: `services/vision/src/output.py`

Implement class `VisionOutputBuilder`:
- `__init__(self)`
  - Initialize empty output structure matching VisionOutput interface
  - Start latency timer for capture, extraction phases

- `set_cards(self, hole_cards: list, community_cards: list, confidence: float)`
  - Set cards data with confidence

- `set_stack(self, position: str, amount: float, confidence: float)`
  - Add stack data for position

- `set_pot(self, amount: float, confidence: float)`
  - Set pot data

- `set_buttons(self, dealer: str, confidence: float)`
  - Set dealer button position

- `set_positions(self, confidence: float)`
  - Set position assignment confidence

- `set_occlusion(self, roi_name: str, occlusion_pct: float)`
  - Track occlusion percentage per ROI

- `set_action_button(self, button_name: str, button_info: dict)`
  - Add action button info (for research UI mode)

- `set_turn_state(self, is_hero_turn: bool, action_timer: int, confidence: float)`
  - Set turn state (for research UI mode)

- `build(self) -> dict`
  - Calculate total latency
  - Return complete VisionOutput as dict matching proto structure
  - Include timestamp

### 3.3.4 Implement Confidence Gating Logic

**File**: `services/vision/src/gating.py`

Implement:
- `should_gate_element(confidence: float, threshold: float) -> bool`
  - Return True if confidence below threshold
  - Used to mark elements as unreliable

- `compute_overall_confidence(elements: dict) -> float`
  - Aggregate all element confidences
  - Weight by importance (cards > stacks > pot)
  - Return weighted average

---

## 3.4 Implement Game State Parser

### 3.4.1 Create Parser Types

**File**: `packages/shared/src/vision/parser-types.ts`

```typescript
export interface ParsedGameState extends GameState {
  parseErrors: string[];
  missingElements: string[];
  inferredValues: Record<string, any>;
  recommendedAction?: Action;
  safeActionTriggered?: boolean;
}

export interface ParserConfig {
  confidenceThreshold: number;
  occlusionThreshold: number;
  enableInference: boolean;
}
```

### 3.4.2 Implement VisionOutput to GameState Converter

**File**: `packages/orchestrator/src/vision/parser.ts`

Implement class `GameStateParser`:
- `constructor(config: ParserConfig)`

- `parse(visionOutput: VisionOutput, previousState?: GameState): ParsedGameState`
  - Convert VisionOutput to GameState
  - Fill in all GameState fields
  - Track parse errors
  - Return ParsedGameState

- `parseCards(elements: VisionElement[]): Card[]`
  - Convert vision elements to Card objects
  - Filter by confidence
  - Return array of Cards

- `parseStacks(elements: Record<Position, VisionElement>): Map<Position, PlayerInfo>`
  - Convert stack elements to player info
  - Create Map<Position, { stack: number, holeCards?: Card[] }>
  - Handle missing positions

- `parsePot(element: VisionElement): number`
  - Extract pot amount
  - Return as number

### 3.4.3 Implement Position Assignment Logic

**File**: `packages/orchestrator/src/vision/position-inference.ts`

Implement:
- `inferPositions(dealerButton: VisionElement, numPlayers: number): PositionMap`
  - Determine button position from dealer button location
  - Calculate SB, BB, and other positions
  - Return mapping of screen location to Position

- `inferHeroPosition(layout: LayoutPack): Position`
  - Hero is typically at bottom center
  - Return Position enum value

- `assignPositions(stacks: Map<Position, PlayerInfo>, dealerButton: Position): Map<Position, PlayerInfo>`
  - Rotate positions based on dealer button
  - Return updated map with correct positions

### 3.4.4 Implement State Sync Error Tracking

**File**: `packages/orchestrator/src/vision/state-sync.ts`

Implement class `StateSyncTracker`:
- `constructor(maxFrameHistory: number = 10)`

- `addFrame(state: ParsedGameState): void`
  - Store state in frame history
  - Maintain rolling window

- `detectInconsistencies(currentState: ParsedGameState): string[]`
  - Compare with previous frames
  - Detect impossible transitions (pot decrease, stack increase without win)
  - Return list of inconsistency errors

- `getConsecutiveErrorCount(): number`
  - Count frames with errors in recent history
  - Used for panic stop trigger

### 3.4.5 Implement Legal Actions Calculator

**File**: `packages/orchestrator/src/vision/legal-actions.ts`

Implement:
- `computeLegalActions(state: GameState): Action[]`
  - Determine available actions based on game state
  - Calculate min/max raise amounts
  - Handle all-in scenarios
  - Return array of legal Action objects

- `canFold(state: GameState): boolean`
  - Check if fold is legal (facing bet)

- `canCheck(state: GameState): boolean`
  - Check if check is legal (no bet to call)

- `canCall(state: GameState): boolean`
  - Check if call is legal (facing bet, have chips)

- `canRaise(state: GameState): { legal: boolean, minRaise: number, maxRaise: number }`
  - Calculate raise limits
  - Consider pot size, stack sizes, blinds

---

## 3.5 Add Confidence Gating and SafeAction Trigger

### 3.5.1 Implement SafeAction Decision Logic

**File**: `packages/orchestrator/src/safety/safe-action.ts`

Implement:
- `shouldTriggerSafeAction(state: ParsedGameState, config: BotConfig): boolean`
  - Get confidence threshold from config.vision.confidenceThreshold (default 0.995)
  - Get occlusion threshold from config.vision.occlusionThreshold (default 0.05)
  - Check overall confidence < threshold
  - Check any element occlusion > threshold
  - Check for parse errors
  - Return true if any condition met

- `selectSafeAction(state: ParsedGameState): Action`
  - Preflop: check if possible, else fold
  - Postflop: check if possible, else fold
  - Never raise in safe mode
  - Return safe Action

**Note**: Thresholds come from BotConfig loaded via ConfigurationManager (Task 2), ensuring consistency with Requirement 1.2

### 3.5.2 Implement Forced Action Handler

**File**: `packages/orchestrator/src/safety/forced-actions.ts`

Implement:
- `detectForcedAction(state: GameState, position: Position): Action | null`
  - Check if hero is in blind position and blinds not posted
  - Check if hero is all-in (only one legal action)
  - Return forced Action or null

- `isForcedBlind(state: GameState, position: Position): boolean`
  - Check if position is SB or BB
  - Check if blind not yet posted this hand
  - Return true if blind must be posted

- `isForcedAllIn(state: GameState, heroPosition: Position): boolean`
  - Check if hero stack < min bet
  - Return true if only all-in is legal

### 3.5.3 Integrate SafeAction into Parser

**File**: `packages/orchestrator/src/vision/parser.ts` (extend)

Add to `GameStateParser`:
- `parseWithSafety(visionOutput: VisionOutput, config: BotConfig): ParsedGameState`
  - Call `parse()` first
  - Check if SafeAction should trigger
  - If yes, set `state.recommendedAction = selectSafeAction(state)`
  - Add flag `state.safeActionTriggered = true`
  - Return enhanced ParsedGameState

---

## 3.6 Create Vision Golden Test Suite

### 3.6.1 Create Test Image Dataset

**Directory**: `packages/orchestrator/test/fixtures/vision/`

Create subdirectories:
- `preflop/` - images of preflop scenarios
- `flop/` - images with flop cards
- `turn/` - images with turn card
- `river/` - images with river card
- `occlusion/` - images with popups/overlays
- `edge-cases/` - unusual scenarios

For each scenario, create:
- `scenario-name.png` - screenshot
- `scenario-name.expected.json` - expected parsed GameState

Minimum 10 test images covering:
- Clean preflop state
- Flop with multiple players
- Turn with bet
- River with all-in
- Occluded cards
- Low confidence scenario
- Dealer button at different positions
- Various stack sizes
- Different pot sizes

### 3.6.2 Implement Golden Test Runner

**File**: `packages/orchestrator/test/vision/golden.spec.ts`

Implement tests:
- `describe("Vision Golden Tests")`
  - For each test image:
    - Load image and expected state
    - Run vision pipeline
    - Parse to GameState
    - Compare with expected state
    - Assert confidence scores within range
    - Assert no unexpected parse errors

- `it("parses clean preflop state correctly")`
- `it("detects occlusion in popup scenario")`
- `it("handles low confidence gracefully")`
- `it("infers positions correctly")`
- `it("calculates legal actions correctly")`

### 3.6.3 Implement Confidence Scoring Tests

**File**: `packages/orchestrator/test/vision/confidence.spec.ts`

Implement tests:
- `it("calculates per-element confidence correctly")`
  - Mock vision elements with known confidences
  - Verify aggregation logic

- `it("triggers SafeAction when confidence below threshold")`
  - Create state with low confidence
  - Verify SafeAction triggered

- `it("does not trigger SafeAction when confidence above threshold")`
  - Create state with high confidence
  - Verify normal operation

### 3.6.4 Implement Occlusion Detection Tests

**File**: `packages/orchestrator/test/vision/occlusion.spec.ts`

Implement tests:
- `it("detects occluded ROI from low variance")`
  - Create uniform color image
  - Verify occlusion detected

- `it("does not flag normal cards as occluded")`
  - Use real card images
  - Verify no false positives

- `it("triggers SafeAction when occlusion exceeds threshold")`
  - Create state with high occlusion
  - Verify SafeAction triggered

### 3.6.5 Implement State Sync Tests

**File**: `packages/orchestrator/test/vision/state-sync.spec.ts`

Implement tests:
- `it("detects impossible pot decrease")`
  - Create sequence with pot going down
  - Verify inconsistency detected

- `it("detects impossible stack increase mid-hand")`
  - Create sequence with stack increasing
  - Verify inconsistency detected

- `it("allows valid state transitions")`
  - Create valid hand sequence
  - Verify no false positives

- `it("tracks consecutive error count")`
  - Create sequence with errors
  - Verify counter increments

---

## 3.7 Write Unit Tests for SafeAction Policy

### 3.7.1 Test SafeAction Selection

**File**: `packages/orchestrator/test/safety/safe-action.spec.ts`

Implement tests:
- `describe("SafeAction Selection")`

- `it("selects check preflop when legal")`
  - Create preflop state with check legal
  - Verify SafeAction is check

- `it("selects fold preflop when check not legal")`
  - Create preflop state with bet facing
  - Verify SafeAction is fold

- `it("selects check postflop when legal")`
  - Create postflop state with check legal
  - Verify SafeAction is check

- `it("selects fold postflop when check not legal")`
  - Create postflop state with bet facing
  - Verify SafeAction is fold

- `it("never selects raise in safe mode")`
  - Create various states
  - Verify raise never selected

### 3.7.2 Test Forced Action Handling

**File**: `packages/orchestrator/test/safety/forced-actions.spec.ts`

Implement tests:
- `describe("Forced Action Handling")`

- `it("detects forced small blind")`
  - Create state with hero in SB position
  - Verify forced blind detected

- `it("detects forced big blind")`
  - Create state with hero in BB position
  - Verify forced blind detected

- `it("detects forced all-in")`
  - Create state with hero stack < min bet
  - Verify forced all-in detected

- `it("posts blinds automatically")`
  - Create blind scenario
  - Verify blind action returned

- `it("does not override forced actions with SafeAction")`
  - Create forced action scenario with low confidence
  - Verify forced action takes precedence

### 3.7.3 Test Confidence Gating Triggers

**File**: `packages/orchestrator/test/safety/confidence-gating.spec.ts`

Implement tests:
- `describe("Confidence Gating")`

- `it("triggers SafeAction when overall confidence < 0.995")`
  - Create state with confidence 0.99
  - Verify SafeAction triggered

- `it("triggers SafeAction when any element occluded > 5%")`
  - Create state with 6% occlusion
  - Verify SafeAction triggered

- `it("does not trigger when confidence = 0.995")`
  - Create state with exact threshold
  - Verify normal operation

- `it("does not trigger when occlusion = 5%")`
  - Create state with exact threshold
  - Verify normal operation

- `it("uses config thresholds correctly")`
  - Create custom config with different thresholds
  - Verify thresholds respected

---

## 3.8 Wire Vision System into Orchestrator

### 3.8.1 Create Vision Client (TypeScript)

**File**: `packages/orchestrator/src/vision/client.ts`

Implement class `VisionClient`:
- `constructor(serviceUrl: string, layoutPack: LayoutPack)`
  - Initialize gRPC client
  - Store layout pack

- `async captureAndParse(): Promise<VisionOutput>`
  - Call vision service via gRPC
  - Pass layout pack
  - Receive VisionOutput
  - Return typed result

- `async healthCheck(): Promise<boolean>`
  - Ping vision service
  - Return true if healthy

### 3.8.2 Create Vision Service gRPC Server (Python)

**File**: `services/vision/src/server.py`

Implement:
- `class VisionServicer(vision_pb2_grpc.VisionServiceServicer)`
  - `__init__(self, model_manager: ModelManager)`
  - `CaptureFrame(self, request, context) -> VisionOutput`
    - Capture screen
    - Extract ROIs
    - Recognize elements
    - Detect occlusions
    - Build VisionOutput
    - Return response

- `def serve(port: int = 50052)`
  - Create gRPC server
  - Add VisionServicer
  - Start server
  - Block until shutdown

### 3.8.3 Update Proto Definitions

**File**: `proto/vision.proto`

Define:
```protobuf
syntax = "proto3";

package vision;

service VisionService {
  rpc CaptureFrame(CaptureRequest) returns (VisionOutput);
  rpc HealthCheck(Empty) returns (HealthStatus);
}

message CaptureRequest {
  string layout_json = 1;
}

message VisionOutput {
  int64 timestamp = 1;
  CardData cards = 2;
  map<string, StackData> stacks = 3;  // Position -> StackData
  AmountData pot = 4;
  ButtonData buttons = 5;
  PositionData positions = 6;
  map<string, double> occlusion = 7;  // ROI name -> occlusion percentage
  ActionButtons action_buttons = 8;
  TurnState turn_state = 9;
  LatencyData latency = 10;
}

message CardData {
  repeated Card hole_cards = 1;
  repeated Card community_cards = 2;
  double confidence = 3;
}

message Card {
  string rank = 1;  // "2"-"A"
  string suit = 2;  // "h", "d", "c", "s"
}

message StackData {
  double amount = 1;
  double confidence = 2;
}

message AmountData {
  double amount = 1;
  double confidence = 2;
}

message ButtonData {
  string dealer = 1;  // Position as string
  double confidence = 2;
}

message PositionData {
  double confidence = 1;
}

message ActionButtons {
  ButtonInfo fold = 1;
  ButtonInfo check = 2;
  ButtonInfo call = 3;
  ButtonInfo raise = 4;
  ButtonInfo bet = 5;
  ButtonInfo all_in = 6;
}

message ButtonInfo {
  ScreenCoords screen_coords = 1;
  bool is_enabled = 2;
  bool is_visible = 3;
  double confidence = 4;
  string text = 5;
}

message ScreenCoords {
  int32 x = 1;
  int32 y = 2;
}

message TurnState {
  bool is_hero_turn = 1;
  int32 action_timer = 2;  // seconds remaining, 0 if unknown
  double confidence = 3;
}

message LatencyData {
  double capture = 1;
  double extraction = 2;
  double total = 3;
}

message Empty {}

message HealthStatus {
  bool healthy = 1;
  string message = 2;
}
```

### 3.8.4 Integrate into Main Pipeline

**File**: `packages/orchestrator/src/main.ts` (extend)

Add to main loop:
- Initialize VisionClient
- Load layout pack from config
- In decision loop:
  - Call `visionClient.captureAndParse()`
  - Pass to `GameStateParser.parseWithSafety()`
  - Check if SafeAction triggered
  - Continue to strategy or return SafeAction

---

## Testing and Validation

### Run All Tests
```bash
# TypeScript tests
pnpm --filter @poker-bot/orchestrator test

# Python tests
cd services/vision
poetry run pytest

# Integration test
pnpm run test:vision:integration
```

### Validation Checklist
- [ ] Layout pack loads and validates correctly
- [ ] Screen capture works on target platform
- [ ] ONNX models load and run inference
- [ ] Confidence scores are in [0, 1] range
- [ ] Occlusion detection triggers correctly
- [ ] GameState parser produces valid output
- [ ] Position inference works for all scenarios
- [ ] Legal actions calculated correctly
- [ ] SafeAction triggers at correct thresholds
- [ ] Forced actions override SafeAction
- [ ] Golden tests pass with >95% accuracy
- [ ] State sync detects inconsistencies
- [ ] All unit tests pass
- [ ] No TypeScript compilation errors
- [ ] No Python linting errors

---

## Success Criteria

Task 3 is complete when:
1. Vision service captures frames and extracts elements with ONNX models
2. Confidence scoring and occlusion detection work correctly
3. GameState parser converts VisionOutput to valid GameState
4. SafeAction policy triggers at correct thresholds
5. Forced actions are handled properly
6. All golden tests pass
7. All unit tests pass (SafeAction, confidence, occlusion, state-sync)
8. Integration with orchestrator works end-to-end
9. No compilation or linting errors
10. Documentation is complete

---

## Notes

- Start with simulator layout pack for easier testing
- ONNX models can be simple initially, improve later
- Template matching fallback ensures robustness
- SafeAction policy prioritizes safety over profit
- Forced actions must never be overridden
- Confidence thresholds are configurable via BotConfig (loaded via ConfigurationManager from Task 2)
- State sync prevents acting on corrupted data
- Golden tests provide regression protection
- Layout packs are stored in `config/layout-packs/` per project_structure.md
- VisionOutput structure matches design.md:214-280 with typed fields for cards/stacks/pot/buttons
- Research UI mode requires additional fields: actionButtons, turnState, window detection metadata
- Proto definitions use keyed messages (CardData, StackData, etc.) not flat name/value lists
