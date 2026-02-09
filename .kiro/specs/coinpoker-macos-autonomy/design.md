# Design Document: CoinPoker macOS Autonomy

## Overview

This design extends the existing poker bot architecture to enable autonomous play on CoinPoker for macOS. The bot's decision-making core (orchestrator, agents, solver) is already complete and tested. This feature adds three key layers:

1. **macOS OS-automation** via nut.js and AppleScript for window management and input simulation
2. **Vision integration** with template matching for turn detection and button localization
3. **Game loop** that continuously polls vision, invokes the decision pipeline, and executes actions

The design maintains strict separation between decision-making (orchestrator) and execution (executor), with vision serving as the bridge between the poker client UI and the bot's internal state representation.

## Relationship to Existing Implementation

The following components already exist and should be **extended** (not recreated) during implementation:

| Component | Location | Current State | Action Needed |
|---|---|---|---|
| `VisionClient` | `packages/orchestrator/src/vision/client.ts` | Working gRPC client with `captureAndParse()` and `healthCheck()` | Extend retry logic; add vision-based turn state derivation |
| `GameStateParser` | `packages/orchestrator/src/vision/parser.ts` | Converts `VisionOutput` → `GameState` | Use as-is in the game loop |
| `validateConnectivity` | `packages/orchestrator/src/startup/validateConnectivity.ts` | Performs vision health check at startup | Reuse in CLI runner startup sequence |
| `WindowManager` | `packages/executor/src/window_manager.ts` | Stub: `findPokerWindow()` returns mock data, `focusWindow()` is a no-op | Replace stubs with real AppleScript implementation |
| `ComplianceChecker` | `packages/executor/src/compliance.ts` | Stub: uses mock process lists instead of real OS queries | Replace stubs with real macOS process detection |
| `BetInputHandler` | `packages/executor/src/bet_input_handler.ts` | Stub: `typeCharacter()`, `clearInputField()`, `locateBetInputField()` do nothing | Replace stubs with nut.js calls |
| `ResearchUIExecutor` | `packages/executor/src/research_bridge.ts` | Stub: `moveMouse()`, `clickMouse()` are empty; `getCurrentTurnState()` returns mock | Replace stubs with nut.js + vision integration |
| `LayoutPack` type | `packages/shared/src/vision/types.ts` | Complete TypeScript interface | Use as-is; layout pack JSON must conform to this |
| `loadLayoutPack` | `packages/shared/src/vision/layout-loader.ts` | Loads and validates layout pack JSON files | Use as-is |
| Vision gRPC health check | `proto/vision.proto` + Python server | Already defined and partially implemented | Verify and add tests |

An earlier detailed implementation plan exists at `docs/plans/2026-02-03-coinpoker-autonomy.md`. This design document is the authoritative spec; the earlier plan may be referenced for code-level details but this document takes precedence on architecture and interface decisions.

## Architecture

### High-Level Flow

```
┌─────────────────┐
│  CoinPoker UI   │
└────────┬────────┘
         │ (screenshots)
         ▼
┌─────────────────┐
│ Vision Service  │ ◄─── Template Assets (Layout Pack)
│   (Python)      │
└────────┬────────┘
         │ (gRPC: VisionOutput)
         ▼
┌─────────────────┐
│   Game Loop     │
│  (TypeScript)   │
└────────┬────────┘
         │
         ├──► Hand Fingerprinting (dedup)
         │
         ├──► Decision Pipeline (Orchestrator)
         │    └──► GTO Solver + Agent Coordinator
         │
         └──► Executor (ResearchUIExecutor)
              ├──► WindowManager (AppleScript)
              ├──► ComplianceChecker
              └──► nut.js (mouse/keyboard)
                   │
                   ▼
              ┌─────────────────┐
              │  CoinPoker UI   │
              └─────────────────┘
```

### Coordinate Space & Scaling

All vision-derived coordinates are in the layout pack's coordinate space. The executor must translate these into screen coordinates using the layout pack's `dpiCalibration` factor (e.g., 2.0 for macOS Retina) and the current window bounds. If the current window dimensions differ from the layout pack's `resolution`, the executor must scale coordinates proportionally before clicking. The existing `WindowManager.roiToScreenCoords()` method already handles offset translation and can be extended for DPI scaling.

### Component Responsibilities

**Vision Service (Python)**
- Captures screenshots of the poker table
- Loads template assets from layout packs
- Performs template matching for buttons, cards, and dealer button
- Extracts game state (stacks, pot, cards, button positions)
- Returns button locations and enabled/disabled state via gRPC

**Game Loop (TypeScript)**
- Polls vision service at configured intervals
- Computes hand fingerprints to avoid duplicate decisions
- Invokes decision pipeline when it's the bot's turn
- Passes actions to executor for execution
- Handles errors and triggers safe mode on repeated failures

**WindowManager (TypeScript + AppleScript)**
- Discovers CoinPoker windows by process name and title patterns
- Focuses windows before action execution
- Retrieves window bounds for coordinate translation
- Validates window dimensions meet minimum requirements

**ComplianceChecker (TypeScript)**
- Verifies CoinPoker process is running
- Checks process name against allowlist/prohibited list
- Validates build flags if configured
- Prevents action execution in non-compliant environments

**ResearchUIExecutor (TypeScript + nut.js)**
- Translates poker actions to OS-level automation
- Uses vision output for button coordinates
- Handles mouse movement and clicking via nut.js
- Handles keyboard input for bet amounts via nut.js
- Validates actions before execution

## Components and Interfaces

**Type Alignment Note:** Interface shapes in this document are illustrative. Implementation should use existing types from `@poker-bot/shared` (e.g., `VisionOutput`, `GameState`) and existing executor config types, only extending them where the requirements introduce new fields.

### WindowManager Interface

```typescript
interface WindowInfo {
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  processName: string;
}

interface WindowManager {
  /**
   * Discovers CoinPoker windows matching configured patterns.
   * Returns null if no valid window is found.
   */
  findWindow(): Promise<WindowInfo | null>;
  
  /**
   * Focuses the specified window.
   * Throws if window cannot be focused.
   */
  focusWindow(window: WindowInfo): Promise<void>;
  
  /**
   * Validates window dimensions meet minimum requirements.
   */
  validateWindowSize(window: WindowInfo, minSize: { width: number; height: number }): boolean;
}
```

**Implementation Notes:**
- Uses AppleScript via `osascript` command for window discovery
- AppleScript queries: `tell application "System Events" to get name of every process`
- Window title matching: `tell application "System Events" to get title of every window of process "CoinPoker"`
- Focus command: `tell application "CoinPoker" to activate`
- Bounds retrieval: `tell application "System Events" to get position and size of window 1 of process "CoinPoker"`

### ComplianceChecker Interface

```typescript
interface ComplianceConfig {
  allowlist: string[];
  prohibitedSites: string[];
  requireBuildFlag: boolean;
}

interface ComplianceChecker {
  /**
   * Validates the environment is compliant for action execution.
   * Throws descriptive error if non-compliant.
   */
  checkCompliance(processName: string, config: ComplianceConfig): Promise<void>;
  
  /**
   * Checks if a process is currently running.
   */
  isProcessRunning(processName: string): Promise<boolean>;
}
```

**Implementation Notes:**
- Process check via AppleScript: `tell application "System Events" to get name of every process`
- Build flag check via environment variable lookup
- Throws specific error types: `ProcessNotRunningError`, `ProhibitedSiteError`, `BuildFlagMissingError`

### InputAutomation Interface (nut.js wrapper)

```typescript
interface Point {
  x: number;
  y: number;
}

interface InputAutomation {
  /**
   * Moves mouse to coordinates and clicks.
   */
  clickAt(point: Point): Promise<void>;
  
  /**
   * Types text using keyboard simulation.
   */
  typeText(text: string): Promise<void>;
  
  /**
   * Clears text field (select all + delete).
   */
  clearTextField(): Promise<void>;
}
```

**Implementation Notes:**
- Uses `@nut-tree/nut-js` library
- Mouse movement: `mouse.move(straightTo(point))`
- Click: `mouse.leftClick()`
- Keyboard: `keyboard.type(text)`
- Clear field: `keyboard.pressKey(Key.LeftCmd, Key.A)` then `keyboard.pressKey(Key.Backspace)`

### VisionClient Interface

```typescript
type VisionOutput = import("@poker-bot/shared").VisionOutput;

interface VisionClient {
  /**
   * Captures current table state and detects buttons.
   * Retries up to configured limit on timeout.
   */
  captureAndParse(): Promise<VisionOutput>;
  
  /**
   * Health check for vision service availability.
   */
  healthCheck(): Promise<boolean>;
}
```

**Implementation Notes:**
- **Extends existing** `VisionClient` at `packages/orchestrator/src/vision/client.ts`, which already implements `captureAndParse()` and `healthCheck()` over gRPC
- Timeout configuration per request (already supported)
- Retry logic with exponential backoff (extend existing timeout handling)
- The layout pack is loaded once when constructing the VisionClient; it is not passed per call (already the pattern)
- The vision service already implements a `healthCheck` RPC in the proto and Python server; verify and add tests
- The existing `validateConnectivity.ts` already calls `healthCheck()` at startup; the CLI runner should reuse it

### GameLoop Interface

```typescript
interface GameLoopConfig {
  pollingIntervalMs: number;
  visionRetryLimit: number;
  errorThreshold: number;
  errorWindowMs: number;
}

interface GameLoop {
  /**
   * Starts the continuous polling cycle.
   * Runs until stop() is called or fatal error occurs.
   */
  start(): Promise<void>;
  
  /**
   * Stops the polling cycle gracefully.
   */
  stop(): Promise<void>;
  
  /**
   * Checks if it's the bot's turn based on vision output.
   */
  isBotTurn(visionOutput: VisionOutput): boolean;
  
  /**
   * Computes hand fingerprint for deduplication.
   */
  computeHandFingerprint(gameState: GameState): string;
}
```

**Implementation Notes:**
- Polling loop uses an async `while (!stopped)` loop with `await sleep(interval)` to avoid overlapping iterations; only one decision cycle may run at a time (single-flight)
- Hand fingerprint: hash of (handId, street, actionHistory length) to avoid pot-size jitter within the same hand
- Error tracking: sliding window of timestamps
- Safe mode trigger: when error count exceeds threshold within time window
- The game loop uses the existing `GameStateParser` (`packages/orchestrator/src/vision/parser.ts`) to convert `VisionOutput` into `GameState` before passing to the decision pipeline
- The existing `SafeModeController` (`packages/orchestrator/src/health/safeModeController.ts`) should be reused for safe mode state management

## Data Models

### ResearchUIConfig Extension

**Note:** Several of these fields already exist in the codebase:
- `WindowConfig` in `packages/executor/src/types.ts` already has `titlePatterns`, `processNames`, `minWindowSize`
- `ComplianceConfig` in `packages/executor/src/types.ts` already has `allowlist`, `prohibitedSites`, `requireBuildFlag`
- `InputField` in `packages/executor/src/types.ts` already has `x`, `y`, `width`, `height`
- `BotConfig.execution.researchUI` in `packages/shared/src/config/types.ts` already has `allowlist`, `prohibitedSites`, `requireBuildFlag`

The only truly new fields are `betInputField` (extending `InputField` with formatting config) and `minRaiseAmount`.

```typescript
import type { InputField } from './types';

// Extends existing InputField (x, y, width, height) with bet formatting config
interface BetInputConfig extends InputField {
  decimalPrecision: number;
  decimalSeparator: '.' | ',';
}

// These fields are added to the existing BotConfig.execution.researchUI
interface ResearchUIConfigExtension {
  // Already exist in codebase:
  // allowlist: string[];
  // prohibitedSites: string[];
  // requireBuildFlag: boolean;
  
  // These must be added to BotConfig.execution.researchUI and will be
  // mapped to the existing WindowConfig type when constructing the executor:
  windowTitlePatterns: string[];  // → WindowConfig.titlePatterns
  processNames: string[];         // → WindowConfig.processNames
  minWindowSize: { width: number; height: number }; // → WindowConfig.minWindowSize

  // New fields for macOS autonomy:
  betInputField: BetInputConfig;
  minRaiseAmount: number;
}
```

### Layout Pack Schema

The layout pack JSON must conform to the existing `LayoutPack` interface defined in `packages/shared/src/vision/types.ts` and validated by `packages/shared/src/vision/layout-loader.ts`. Field names below match the TypeScript interface exactly.

```json
{
  "version": "1.0.0",
  "platform": "coinpoker",
  "theme": "default",
  "resolution": { "width": 2560, "height": 1440 },
  "dpiCalibration": 2.0,
  "cardROIs": [
    { "x": 100, "y": 200, "width": 50, "height": 70 },
    { "x": 160, "y": 200, "width": 50, "height": 70 },
    { "x": 300, "y": 150, "width": 50, "height": 70 },
    { "x": 360, "y": 150, "width": 50, "height": 70 },
    { "x": 420, "y": 150, "width": 50, "height": 70 },
    { "x": 480, "y": 150, "width": 50, "height": 70 },
    { "x": 540, "y": 150, "width": 50, "height": 70 }
  ],
  "stackROIs": {
    "BTN": { "x": 400, "y": 400, "width": 80, "height": 25 },
    "SB":  { "x": 250, "y": 400, "width": 80, "height": 25 },
    "BB":  { "x": 150, "y": 350, "width": 80, "height": 25 },
    "UTG": { "x": 150, "y": 200, "width": 80, "height": 25 },
    "MP":  { "x": 400, "y": 150, "width": 80, "height": 25 },
    "CO":  { "x": 600, "y": 200, "width": 80, "height": 25 }
  },
  "potROI": { "x": 400, "y": 100, "width": 100, "height": 30 },
  "buttonROI": { "x": 350, "y": 250, "width": 30, "height": 30 },
  "actionButtonROIs": {
    "fold":  { "x": 100, "y": 500, "width": 80, "height": 40 },
    "check": { "x": 200, "y": 500, "width": 80, "height": 40 },
    "call":  { "x": 200, "y": 500, "width": 80, "height": 40 },
    "raise": { "x": 300, "y": 500, "width": 80, "height": 40 },
    "bet":   { "x": 300, "y": 500, "width": 80, "height": 40 },
    "allIn": { "x": 400, "y": 500, "width": 80, "height": 40 }
  },
  "turnIndicatorROI": { "x": 350, "y": 460, "width": 40, "height": 20 },
  "windowPatterns": {
    "titleRegex": "^CoinPoker.*Table",
    "processName": "CoinPoker"
  },
  "buttonTemplates": {
    "fold":  "templates/coinpoker/buttons/fold.png",
    "check": "templates/coinpoker/buttons/check.png",
    "call":  "templates/coinpoker/buttons/call.png",
    "raise": "templates/coinpoker/buttons/raise.png",
    "allIn": "templates/coinpoker/buttons/allin.png"
  }
}
```

> **Note:** All coordinate values above are placeholders. They must be replaced with actual pixel measurements from CoinPoker screenshots during Task 9 (manual operator work).

### Hand Fingerprint

```typescript
interface HandFingerprint {
  handId: string;
  street: string; // preflop|flop|turn|river
  actionCount: number; // length of action history
  hash: string; // SHA-256 of above fields
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Window Discovery and Selection

*For any* set of running processes and windows, when the WindowManager searches for CoinPoker windows, it should return a window that matches the configured process name and title pattern, or null if no match exists.

**Validates: Requirements 2.1, 2.2**

### Property 2: Window Bounds Retrieval

*For any* discovered window, the WindowManager should retrieve screen bounds that accurately reflect the window's position and dimensions on screen.

**Validates: Requirements 2.3**

### Property 3: Window Size Validation

*For any* window with dimensions below the configured minimum, the WindowManager should reject the window and return null.

**Validates: Requirements 2.5**

### Property 4: Window Focus Before Action

*For any* action execution sequence, the WindowManager should focus the target window before the executor performs any mouse or keyboard operations.

**Validates: Requirements 2.4**

### Property 5: Process Running Verification

*For any* compliance check, when the configured process is not running, the ComplianceChecker should fail and prevent action execution.

**Validates: Requirements 2.6, 2.7**

### Property 6: Process Allowlist Enforcement

*For any* process name not on the configured allowlist, the ComplianceChecker should fail and prevent action execution.

**Validates: Requirements 2.8**

### Property 7: Prohibited Process Rejection

*For any* process name on the prohibited list, the ComplianceChecker should fail and prevent action execution regardless of other configuration.

**Validates: Requirements 2.9**

### Property 8: Build Flag Validation

*For any* configuration with a required build flag, when the flag is not set, the ComplianceChecker should fail with a descriptive error message.

**Validates: Requirements 2.10, 2.11**

### Property 9: Bet Amount Rounding

*For any* bet amount and configured decimal precision, the formatted amount should be rounded to the specified precision.

**Validates: Requirements 3.5**

### Property 10: Minimum Raise Enforcement

*For any* raise action with an amount below the configured minimum, the system should either reject the action or round up to the minimum raise amount.

**Validates: Requirements 3.6**

### Property 11: Decimal Separator Formatting

*For any* bet amount, the formatted string should use the configured decimal separator (period or comma).

**Validates: Requirements 3.7**

### Property 12: Bet Amount Round Trip

*For any* valid bet amount, formatting then parsing the amount should produce a value within the configured precision tolerance of the original.

**Validates: Requirements 3.5, 3.7**

### Property 13: Turn State Derivation

*For any* vision output, the system should derive that it is the bot's turn if and only if action buttons are visible and enabled.

**Validates: Requirements 4.2, 4.3, 4.4**

### Property 14: Vision Retry Behavior

*For any* vision service timeout, the system should retry up to the configured retry limit before aborting the turn check.

**Validates: Requirements 4.5, 4.6**

### Property 15: Vision Coordinate Usage

*For any* vision output that includes button coordinates, those coordinates should be translated from layout pack space to screen space using `dpiCalibration` and window bounds, and the resulting screen coordinates should fall within the window bounds.

**Validates: Requirements 4.7, 12.1, 12.2, 12.3, 12.4**

### Property 16: Template Match Confidence Threshold

*For any* template matching operation, only matches exceeding the confidence threshold should be returned, and when multiple matches exist, the highest confidence match should be selected.

**Validates: Requirements 5.3, 5.4, 5.5**

### Property 17: Layout Pack Version Compatibility

*For any* layout pack with a version that does not match the parser schema version, the system should fail with a descriptive error message during initialization.

**Validates: Requirements 6.9**

### Property 18: Polling Interval Consistency

*For any* configured polling interval, the game loop should query the vision service at approximately that interval (within timing tolerance).

**Validates: Requirements 7.2**

### Property 19: Hand Fingerprint Uniqueness

*For any* two distinct poker hands (different hand ID, street, or action count), the computed hand fingerprints should be different.

**Validates: Requirements 7.3, 7.4**

### Property 20: Hand Fingerprint Stability

*For any* poker hand, computing the fingerprint multiple times with the same game state should produce identical hash values.

**Validates: Requirements 7.3, 7.6**

### Property 21: Hand Deduplication

*For any* hand fingerprint that matches the previous hand, the system should skip decision-making and not invoke the decision pipeline.

**Validates: Requirements 7.4**

### Property 22: Error Recovery Continuation

*For any* non-fatal error encountered during polling, the game loop should log the error and continue to the next polling cycle without stopping.

**Validates: Requirements 7.7**

### Property 23: Health Check Failure Handling

*For any* startup sequence where the vision service health check fails, the CLI should abort startup and exit with a non-zero status code.

**Validates: Requirements 8.4**

### Property 24: Fatal Error Shutdown

*For any* fatal error during operation, the system should shut down gracefully and exit with a non-zero status code.

**Validates: Requirements 8.7**

### Property 25: Configuration Validation

*For any* bot configuration with missing required fields or invalid field values, the system should fail with a descriptive error message during loading.

**Validates: Requirements 9.6, 9.7, 9.8**

### Property 26: Execution Failure Recovery

*For any* executor failure during action execution, the system should log the failure and continue to the next polling cycle without stopping the game loop.

**Validates: Requirements 11.4**

### Property 27: Invalid Action Fallback

*For any* invalid action returned by the decision pipeline, the system should log an error and default to fold.

**Validates: Requirements 11.5**

### Property 28: Error Counter Increment

*For any* error encountered during the game loop, the system should increment the error counter with a timestamp.

**Validates: Requirements 11.6**

### Property 29: Safe Mode Trigger

*For any* error sequence where the error count exceeds the configured threshold within the configured time window, the system should enter safe mode.

**Validates: Requirements 11.7**

### Property 30: Safe Mode Behavior

*For any* system in safe mode, the game loop should continue polling vision for monitoring but should not execute any actions, and should log a critical alert.

**Validates: Requirements 11.8, 11.10**

### Property 31: Coordinate Scaling Correctness

*For any* vision-derived coordinate and layout pack resolution, the translated screen coordinate should equal `windowBounds.x + (visionCoord.x / layoutResolution.width) * windowBounds.width` (and analogously for y), scaled by `dpiCalibration`.

**Validates: Requirements 12.1, 12.2, 12.3**

### Property 32: Out-of-Bounds Coordinate Rejection

*For any* translated screen coordinate that falls outside the window bounds, the system should abort the click action and log an error.

**Validates: Requirements 12.4**

## Error Handling

### Error Categories

**Fatal Errors (abort startup)**
- Vision service unreachable during health check
- Layout pack version mismatch
- Invalid bot configuration (missing required fields)
- Required build flag not set

**Recoverable Errors (log and continue)**
- Vision service timeout (retry up to limit)
- Window not found (retry next polling cycle)
- Action execution failure (log and continue)
- Template file missing (continue with available templates)

**Safe Mode Triggers (stop actions, continue monitoring)**
- Error threshold exceeded within time window
- Repeated compliance check failures
- Repeated vision service failures

### Error Handling Strategy

1. **Validation at Startup**: Fail fast on configuration errors, version mismatches, and missing dependencies
2. **Retry with Backoff**: Vision timeouts and transient network errors get exponential backoff retries
3. **Graceful Degradation**: Missing templates don't crash the system; log warnings and continue
4. **Safe Mode**: Repeated failures trigger safe mode to prevent runaway behavior
5. **Operator Alerts**: Critical errors log alerts for operator intervention

## Testing Strategy

### Unit Testing

**WindowManager Tests**
- Mock AppleScript runner to test window discovery logic
- Test window title pattern matching
- Test window size validation
- Test focus command generation

**ComplianceChecker Tests**
- Test process allowlist/prohibited list logic
- Test build flag validation
- Test error message generation

**InputAutomation Tests**
- Mock nut.js to test click coordinate calculation
- Test bet amount formatting with various precisions and separators
- Test text field clearing logic

**GameLoop Tests**
- Test hand fingerprint computation and deduplication
- Test error counter and safe mode triggering
- Test polling interval timing

**VisionClient Tests**
- Mock gRPC responses to test retry logic
- Test timeout handling
- Test health check behavior

### Property-Based Testing

All correctness properties (Properties 1-32) will be implemented as property-based tests using `fast-check` library (must be installed as a dev dependency first — see Task 0 in tasks.md). Each test will:
- Run minimum 100 iterations with randomized inputs
- Reference the design property number in test comments
- Tag format: `Feature: coinpoker-macos-autonomy, Property N: [property text]`

**Example Property Test Structure:**

```typescript
// Feature: coinpoker-macos-autonomy, Property 19: Hand Fingerprint Uniqueness
test('distinct hands produce distinct fingerprints', () => {
  fc.assert(
    fc.property(
      fc.record({
        handId: fc.string({ minLength: 8, maxLength: 16 }),
        street: fc.constantFrom('preflop', 'flop', 'turn', 'river'),
        actionCount: fc.integer({ min: 0, max: 20 })
      }),
      fc.record({
        handId: fc.string({ minLength: 8, maxLength: 16 }),
        street: fc.constantFrom('preflop', 'flop', 'turn', 'river'),
        actionCount: fc.integer({ min: 0, max: 20 })
      }),
      (hand1, hand2) => {
        fc.pre(!handsAreEqual(hand1, hand2)); // Only test distinct hands
        const fp1 = computeHandFingerprint(hand1);
        const fp2 = computeHandFingerprint(hand2);
        expect(fp1.hash).not.toBe(fp2.hash);
      }
    ),
    { numRuns: 100 }
  );
});
```

### Integration Testing

**Vision + Executor Integration**
- Test full flow: vision output → button coordinates → nut.js click
- Test disabled button handling
- Test missing button error handling

**Game Loop Integration**
- Test full decision cycle: poll → fingerprint → decide → execute
- Test safe mode triggering with simulated errors
- Test graceful shutdown on stop signal

### Manual Testing Checklist

Before live CoinPoker testing:
1. Verify layout pack ROIs match actual CoinPoker table layout
2. Verify template assets have sufficient confidence thresholds
3. Test window discovery with CoinPoker running
4. Test compliance checks with various process states
5. Test bet input formatting with CoinPoker's input field
6. Verify safe mode triggers correctly with simulated errors

## Implementation Notes

### Technology Choices

**nut.js for Input Automation**
- Cross-platform (macOS, Windows, Linux)
- Native Node.js bindings (no Python bridge needed)
- Smooth mouse movement with `mouse.move(straightTo(point))` (not `setPosition` which teleports instantly)
- Keyboard simulation with modifier key support
- Human-like timing uses the existing `deterministicRandom` helper for reproducible jitter

**AppleScript for Window Management**
- Native macOS window management
- Process discovery and window enumeration
- Window focusing and bounds retrieval
- Executed via `osascript` command from Node.js

**Template Matching MVP**
- OpenCV `matchTemplate()` with `TM_CCOEFF_NORMED` method
- Confidence threshold: 0.8 (configurable per template)
- Grayscale conversion for robustness
- Multi-scale matching for resolution variations

### Performance Considerations

**Polling Interval**: 500ms default (configurable)
- Fast enough to catch turns promptly
- Slow enough to avoid excessive CPU usage

**Vision Service Timeout**: 2000ms default
- Allows time for screenshot capture and processing
- Short enough to avoid blocking the game loop

**Retry Backoff**: Exponential with 100ms base
- First retry: 100ms delay
- Second retry: 200ms delay
- Third retry: 400ms delay

### Security Considerations

**Process Allowlist**: Prevents accidental execution on wrong poker clients
**Build Flag Gating**: Allows disabling live mode in production builds
**Safe Mode**: Prevents runaway behavior on repeated errors
**Operator Intervention**: Critical errors require manual resolution

## Future Enhancements

**ONNX Model Support** (post-MVP)
- Replace template matching with neural network button detection
- More robust to UI variations and lighting changes
- Requires training data collection and model training

**Multi-Table Support** (post-MVP)
- Extend WindowManager to track multiple windows
- Parallel game loops for concurrent tables
- Shared decision pipeline with time budget allocation

**Adaptive Polling** (post-MVP)
- Increase polling frequency when it's likely the bot's turn
- Decrease frequency during opponent turns
- Reduces CPU usage while maintaining responsiveness
