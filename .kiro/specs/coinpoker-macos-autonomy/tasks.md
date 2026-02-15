# Implementation Plan: CoinPoker macOS Autonomy

## Overview

This implementation plan breaks down the CoinPoker macOS autonomy feature into discrete, incremental coding tasks. Each task builds on previous work and includes testing to validate functionality early. The plan follows a bottom-up approach: infrastructure first (window management, input automation), then vision integration, then game loop orchestration, and finally configuration and documentation.

## Tasks

- [x] 0. Install `fast-check` as dev dependency for property-based testing
  - Run `pnpm --filter @poker-bot/executor add -D fast-check`
  - Run `pnpm --filter @poker-bot/orchestrator add -D fast-check`
  - Verify import works in a trivial test
  - _Prerequisite for all property tests in tasks 2–13_

- [x] 1. Extend ResearchUIConfig schema and add validation
  - **Note:** `WindowConfig` (titlePatterns, processNames, minWindowSize) and `ComplianceConfig` (allowlist, prohibitedSites, requireBuildFlag) already exist in `packages/executor/src/types.ts`. `BotConfig.execution.researchUI` in `packages/shared/src/config/types.ts` already has allowlist, prohibitedSites, requireBuildFlag.
  - Add `betInputField` to `BotConfig.execution.researchUI` (extends existing `InputField` with `decimalPrecision` and `decimalSeparator`)
  - Add `minRaiseAmount` to `BotConfig.execution.researchUI`
  - Wire new fields through `createActionExecutor` into `BetInputHandler` constructor
  - Implement config validation that checks new required fields are present
  - _Requirements: 1.3, 1.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
  
  - [x] 1.1 Write unit tests for config validation
    - Test missing required fields produce descriptive errors
    - Test invalid field values produce validation errors
    - _Requirements: 9.6, 9.7, 9.8_

- [ ] 2. Extend existing WindowManager with real macOS AppleScript implementation
  - [ ] 2.1 Replace stubs in existing `packages/executor/src/window_manager.ts` with AppleScript runner
    - **Existing:** `findPokerWindow()` returns mock data; `focusWindow()` is a no-op; `getWindowBounds()` returns placeholder bounds; `detectDPIScale()` returns 1
    - Replace `findPokerWindow()` with AppleScript window discovery by process name and title patterns
    - Replace `focusWindow()` with AppleScript `set frontmost to true`
    - Replace `getWindowBounds()` with AppleScript position/size query
    - Replace `detectDPIScale()` with actual macOS Retina detection
    - Existing `validateWindow()`, `roiToScreenCoords()`, `buttonToScreenCoords()`, `isButtonActionable()`, `findActionButton()` can be kept and extended
    - Add injectable `AppleScriptRunner` for testability (mock in tests, real `osascript` in production)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [ ] 2.2 Write property test for window discovery
    - **Property 1: Window Discovery and Selection**
    - **Validates: Requirements 2.1, 2.2**
  
  - [ ] 2.3 Write property test for window bounds retrieval
    - **Property 2: Window Bounds Retrieval**
    - **Validates: Requirements 2.3**
  
  - [ ] 2.4 Write property test for window size validation
    - **Property 3: Window Size Validation**
    - **Validates: Requirements 2.5**
  
  - [ ] 2.5 Write unit tests for window focus behavior
    - Test focus is called before actions
    - Test focus failure handling
    - _Requirements: 2.4_

- [ ] 3. Extend existing ComplianceChecker with real macOS process detection
  - [ ] 3.1 Replace stubs in existing `packages/executor/src/compliance.ts`
    - **Existing:** `checkRunningProcesses()` uses hardcoded mock process list; `checkProhibitedSites()` uses hardcoded mock site list
    - Replace `checkRunningProcesses()` with real macOS process enumeration (via AppleScript or `ps -A`)
    - Replace `checkProhibitedSites()` with real window/process scanning
    - Add injectable `processListProvider` for testability
    - Keep existing `isResearchUIModeAllowed()`, `validateExecution()`, `validateSite()`, `isProcessProhibited()` logic
    - _Requirements: 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_
  
  - [ ] 3.2 Write property test for process running verification
    - **Property 5: Process Running Verification**
    - **Validates: Requirements 2.6, 2.7**
  
  - [ ] 3.3 Write property test for allowlist enforcement
    - **Property 6: Process Allowlist Enforcement**
    - **Validates: Requirements 2.8**
  
  - [ ] 3.4 Write property test for prohibited process rejection
    - **Property 7: Prohibited Process Rejection**
    - **Validates: Requirements 2.9**
  
  - [ ] 3.5 Write property test for build flag validation
    - **Property 8: Build Flag Validation**
    - **Validates: Requirements 2.10, 2.11**

- [ ] 4. Implement InputAutomation wrapper for nut.js and extend BetInputHandler
  - [ ] 4.1 Create InputAutomation class wrapping nut.js
    - Implement clickAt() using `mouse.move(straightTo(point))` then `mouse.leftClick()` (not `setPosition`)
    - Implement typeText() using `keyboard.type(text)`
    - Implement clearTextField() using `Cmd+A` then `Backspace`
    - Handle coordinate translation from layout pack space to screen space using `dpiCalibration` and window bounds
    - Add human-like pre-action delay (1–3s) using `deterministicRandom` before clicking
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.8, 3.9, 3.10, 12.1, 12.2, 12.3, 12.5_
  
  - [ ] 4.2 Extend existing BetInputHandler with formatting and nut.js integration
    - **Existing:** `packages/executor/src/bet_input_handler.ts` has stub `typeCharacter()`, `clearInputField()`, `locateBetInputField()` that do nothing
    - Replace stubs with nut.js calls via InputAutomation
    - Accept `BetInputConfig` (extends `InputField` with `decimalPrecision`, `decimalSeparator`) in constructor
    - Implement bet amount rounding to configured decimal precision
    - Implement minimum raise enforcement
    - Implement decimal separator formatting
    - Add random inter-keystroke delays (50–200ms) using `deterministicRandom`
    - _Requirements: 3.5, 3.6, 3.7, 3.11_
  
  - [ ] 4.3 Write property test for bet amount rounding
    - **Property 9: Bet Amount Rounding**
    - **Validates: Requirements 3.5**
  
  - [ ] 4.4 Write property test for minimum raise enforcement
    - **Property 10: Minimum Raise Enforcement**
    - **Validates: Requirements 3.6**
  
  - [ ] 4.5 Write property test for decimal separator formatting
    - **Property 11: Decimal Separator Formatting**
    - **Validates: Requirements 3.7**
  
  - [ ] 4.6 Write property test for bet amount round trip
    - **Property 12: Bet Amount Round Trip**
    - **Validates: Requirements 3.5, 3.7**
  
  - [ ] 4.7 Write property test for coordinate scaling correctness
    - **Property 31: Coordinate Scaling Correctness**
    - **Validates: Requirements 12.1, 12.2, 12.3**
  
  - [ ] 4.8 Write property test for out-of-bounds coordinate rejection
    - **Property 32: Out-of-Bounds Coordinate Rejection**
    - **Validates: Requirements 12.4**

- [ ] 5. Checkpoint - Ensure executor infrastructure tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Extend existing VisionClient with retry logic for live mode
  - [ ] 6.1 Extend existing VisionClient at `packages/orchestrator/src/vision/client.ts`
    - **Existing:** Working gRPC client with `captureAndParse()` and `healthCheck()`. Layout pack loaded at construction time.
    - Add configurable retry logic with exponential backoff for timeouts (currently throws on first timeout)
    - Treat `UNAVAILABLE` and `DEADLINE_EXCEEDED` as retryable; cap at configured retry limit with backoff
    - Keep existing `captureAndParse()` and `healthCheck()` signatures compatible
    - _Requirements: 4.1, 4.5, 4.6, 8.3, 8.4_
  
  - [ ] 6.2 Write property test for vision retry behavior
    - **Property 14: Vision Retry Behavior**
    - **Validates: Requirements 4.5, 4.6**
  
  - [ ] 6.3 Write property test for health check failure handling
    - **Property 23: Health Check Failure Handling**
    - **Validates: Requirements 8.4**
  
  - [ ] 6.4 Write unit tests for vision client retry and timeout handling
    - Test timeout on first attempt triggers retry
    - Test all retries exhausted aborts turn check
    - **Note:** Existing tests at `packages/orchestrator/test/vision/client.spec.ts` cover basic timeout and health check; extend these
    - _Requirements: 4.5, 4.6_

- [ ] 7. Extend ResearchUIExecutor to use vision output
  - [ ] 7.1 Wire VisionClient into ResearchUIExecutor
    - Add vision client as dependency
    - Implement turn state checking using vision output
    - Use vision button coordinates for click targets
    - Handle disabled buttons by skipping execution and logging warning
    - Handle missing buttons by aborting execution and logging error
    - Update executor/orchestrator entry to pass VisionClient into ResearchUIExecutor (factory or main)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8_
  
  - [ ] 7.2 Write property test for turn state derivation
    - **Property 13: Turn State Derivation**
    - **Validates: Requirements 4.2, 4.3, 4.4**
  
  - [ ] 7.3 Write property test for vision coordinate usage
    - **Property 15: Vision Coordinate Usage**
    - **Validates: Requirements 4.7**
  
  - [ ] 7.4 Write unit tests for disabled button handling
    - Test disabled buttons skip execution and log warning
    - Test missing buttons abort execution and log error
    - _Requirements: 4.3, 4.8_

- [ ] 8. Implement vision service template loading and matching
  - [ ] 8.1 Add template loading to vision service
    - Load template assets from layout pack directory on startup
    - Handle missing template files gracefully with error logging
    - _Requirements: 5.1, 5.6_
  
  - [ ] 8.2 Implement template matching for button detection
    - Use OpenCV matchTemplate with TM_CCOEFF_NORMED
    - Return button location and type when confidence exceeds threshold
    - Return highest confidence match when multiple matches found
    - Return empty result when no matches exceed threshold
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  
  - [ ] 8.3 Implement turn state derivation in vision service
    - Check for presence of fold, call, check, or raise button templates
    - Mark buttons as enabled/disabled based on template matching
    - _Requirements: 5.7_
  
  - [ ] 8.3a Verify and test existing gRPC health check in vision server
    - **Existing:** The vision proto already defines a `healthCheck` RPC, the Python server has a handler, and `VisionClient.healthCheck()` already calls it
    - Verify the existing health check returns correct status when service is ready vs. not ready
    - Add tests for health check success and failure paths
    - Only implement new logic if existing coverage is insufficient
    - _Requirements: 8.3, 8.4_
  
  - [ ] 8.4 Write property test for template match confidence
    - **Property 16: Template Match Confidence Threshold**
    - **Validates: Requirements 5.3, 5.4, 5.5**
  
  - [ ] 8.5 Write unit tests for template loading
    - Test templates load from layout pack directory
    - Test missing template files log errors and continue
    - _Requirements: 5.1, 5.6_

- [ ] 9. Create CoinPoker layout pack with ROIs and templates
  - **⚠️ MANUAL/OPERATOR TASK**: Sub-tasks 9.1–9.3 require manual work with the actual CoinPoker client running on macOS. A coding agent cannot automate screenshot capture or pixel measurement. The operator should complete these steps and provide the assets before automated tasks 9.4–9.6 can be validated.
  
  - [ ] 9.1 **[MANUAL]** Capture CoinPoker table screenshots
    - Open CoinPoker on macOS and join a cash game table (6-max)
    - Set window to target resolution (e.g., 2560x1440 @ 2x Retina)
    - Take full-window screenshots showing: action buttons visible, cards dealt, pot displayed
    - Note the CoinPoker process name from Activity Monitor and window title text
    - _Requirements: 1.1, 1.2, 6.6_
  
  - [ ] 9.2 **[MANUAL]** Measure and define ROIs in layout pack JSON
    - Using the screenshots, measure pixel coordinates for each ROI
    - Create `config/layout-packs/coinpoker/default.layout.json` conforming to existing `LayoutPack` interface:
      - `cardROIs`: array of ROIs for hole cards + community cards
      - `stackROIs`: keyed by Position (BTN, SB, BB, UTG, MP, CO)
      - `potROI`, `buttonROI`, `turnIndicatorROI`: single ROI each
      - `actionButtonROIs`: fold, check, call, raise, bet, allIn
      - `windowPatterns`: titleRegex and processName from step 9.1
      - `resolution`, `dpiCalibration`, `version`, `platform`, `theme`
    - _Requirements: 6.1, 6.2, 6.6, 6.7, 6.8, 6.10_
  
  - [ ] 9.3 **[MANUAL]** Capture and crop template assets
    - Crop button images from screenshots into `services/vision/assets/templates/coinpoker/buttons/`
    - Crop card rank/suit images into `services/vision/assets/templates/coinpoker/cards/`
    - Crop dealer button into `services/vision/assets/templates/coinpoker/dealer.png`
    - Update `buttonTemplates` paths in the layout pack JSON
    - _Requirements: 6.3, 6.4, 6.5_
  
  - [ ] 9.4 Write unit test for layout pack schema validation
    - Test layout pack has all required ROIs (cardROIs, stackROIs, potROI, buttonROI, actionButtonROIs)
    - Test layout pack has all required template file paths in `buttonTemplates`
    - Test layout pack has `version`, `platform`, `resolution`, `dpiCalibration` fields
    - **Note:** Existing `loadLayoutPack()` and `validateLayoutPack()` in `packages/shared/src/vision/layout-loader.ts` already validate against the JSON schema; extend tests to cover CoinPoker-specific layout
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  
  - [ ] 9.5 Write property test for layout pack version compatibility
    - **Property 17: Layout Pack Version Compatibility**
    - **Validates: Requirements 6.9**
  
  - [ ] 9.6 Implement layout pack metadata validation extensions
    - Enforce layout pack version compatibility during load
    - Validate `platform`, `resolution`, `dpiCalibration`, and `windowPatterns` are present
    - Fail with descriptive error on mismatch or missing fields
    - **Note:** Extend existing `validateLayoutPack()` in `packages/shared/src/vision/layout-loader.ts`
    - _Requirements: 1.5, 1.6, 6.7, 6.8, 6.9_

- [ ] 10. Checkpoint - Ensure vision integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement GameLoop with hand fingerprinting
  - [ ] 11.1 Create GameLoop class
    - Implement async polling loop with configurable interval
    - Implement single-flight guarantee (no overlapping iterations)
    - Implement hand fingerprint computation using handId, street, and actionCount
    - Implement hand deduplication to skip duplicate decisions
    - Implement error tracking with sliding window
    - Implement safe mode triggering when error threshold exceeded
    - Use existing `GameStateParser` (`packages/orchestrator/src/vision/parser.ts`) to convert `VisionOutput` → `GameState`
    - Reuse existing `SafeModeController` (`packages/orchestrator/src/health/safeModeController.ts`) for safe mode state management
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.6, 11.7, 11.8_
  
  - [ ] 11.2 Write property test for polling interval consistency
    - **Property 18: Polling Interval Consistency**
    - **Validates: Requirements 7.2**
  
  - [ ] 11.3 Write property test for hand fingerprint uniqueness
    - **Property 19: Hand Fingerprint Uniqueness**
    - **Validates: Requirements 7.3, 7.4**
  
  - [ ] 11.4 Write property test for hand fingerprint stability
    - **Property 20: Hand Fingerprint Stability**
    - **Validates: Requirements 7.3, 7.6**
  
  - [ ] 11.5 Write property test for hand deduplication
    - **Property 21: Hand Deduplication**
    - **Validates: Requirements 7.4**
  
  - [ ] 11.6 Write property test for error recovery continuation
    - **Property 22: Error Recovery Continuation**
    - **Validates: Requirements 7.7**
  
  - [ ] 11.7 Write property test for safe mode trigger
    - **Property 29: Safe Mode Trigger**
    - **Validates: Requirements 11.7**
  
  - [ ] 11.8 Write property test for safe mode behavior
    - **Property 30: Safe Mode Behavior**
    - **Validates: Requirements 11.8, 11.10**

- [ ] 12. Implement CLI runner for live mode
  - [ ] 12.1 Create live mode CLI command
    - Accept command-line arguments for bot config path and log level
    - Accept environment variables for vision service URL, layout pack path, and log level
    - Load bot configuration and validate
    - Initialize VisionClient, Orchestrator, and Executor
    - Reuse existing `validateConnectivity()` from `packages/orchestrator/src/startup/validateConnectivity.ts` for vision health check at startup
    - Start game loop on successful health check
    - Log status updates at regular intervals
    - Handle termination signals gracefully
    - Load and validate layout pack metadata (using existing `loadLayoutPack()`) before starting game loop
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 8.10_
  
  - [ ] 12.2 Write property test for fatal error shutdown
    - **Property 24: Fatal Error Shutdown**
    - **Validates: Requirements 8.7**
  
  - [ ] 12.3 Write unit tests for CLI startup sequence
    - Test config loading and validation
    - Test component initialization
    - Test health check success starts game loop
    - Test health check failure aborts startup
    - Test termination signal handling
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8_

- [ ] 13. Implement error handling and safety gates
  - [ ] 13.1 Add error handling to executor
    - Handle window not found by aborting action and logging error
    - Handle compliance check failure by aborting action
    - Handle vision timeout by aborting decision cycle
    - Handle execution failure by logging and continuing to next cycle
    - Handle invalid action by logging error and defaulting to fold
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [ ] 13.2 Write property test for execution failure recovery
    - **Property 26: Execution Failure Recovery**
    - **Validates: Requirements 11.4**
  
  - [ ] 13.3 Write property test for invalid action fallback
    - **Property 27: Invalid Action Fallback**
    - **Validates: Requirements 11.5**
  
  - [ ] 13.4 Write property test for error counter increment
    - **Property 28: Error Counter Increment**
    - **Validates: Requirements 11.6**
  
  - [ ] 13.5 Write unit tests for error handling
    - Test window not found aborts action
    - Test compliance failure aborts action
    - Test vision timeout aborts decision cycle
    - _Requirements: 11.1, 11.2, 11.3_

- [ ] 14. Create coinpoker.bot.json configuration
  - Create bot configuration file for CoinPoker
  - Set windowTitlePatterns to match CoinPoker window titles
  - Set processNames to CoinPoker process name
  - Set minWindowSize to reasonable minimum (e.g., 1280x720)
  - Configure betInputField with coordinates and formatting
  - Set minRaiseAmount to CoinPoker's minimum
  - Configure `allowlist` with CoinPoker process
  - _Requirements: 1.3, 1.4, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 15. Update operator documentation
  - Document live mode CLI command with all arguments
  - Document required environment variables (VISION_SERVICE_URL, LAYOUT_PACK_PATH, LOG_LEVEL)
  - Document bot configuration schema for CoinPoker
  - Add troubleshooting section for common issues
  - Document expected CoinPoker window setup and table configuration
  - Document how to capture and update layout pack assets
  - Document safety mechanisms (safe mode, error thresholds) and how to stop the bot
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 16. Final checkpoint - Integration testing and validation
  - Run full integration test with mocked vision service
  - Verify all property tests pass (100+ iterations each)
  - Verify all unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks are required for complete implementation (except Task 0, which is a prerequisite)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- **`fast-check` must be installed (Task 0) before any property tests can run**
- Property tests validate universal correctness properties (minimum 100 iterations)
- Unit tests validate specific examples and edge cases
- Implementation follows bottom-up approach: infrastructure → vision → game loop → CLI
- All code should use existing types from `@poker-bot/shared` where possible (especially `LayoutPack`, `VisionOutput`, `GameState`)
- Template matching is MVP approach; ONNX models are future enhancement
- **Task 9 (layout pack + templates) requires manual operator work** — coding agents cannot capture screenshots or measure pixel coordinates
- An earlier implementation plan exists at `docs/plans/2026-02-03-coinpoker-autonomy.md` with code-level details; the `.kiro` spec takes precedence on architecture decisions
- Many components already exist as stubs (WindowManager, ComplianceChecker, BetInputHandler, ResearchUIExecutor) — implementation replaces stubs rather than creating new classes
- Existing tests at `packages/executor/test/` and `packages/orchestrator/test/vision/` should be extended, not replaced
- Key existing utilities to reuse: `deterministicRandom` at `packages/executor/src/rng.ts` (for human-like jitter), `SafeModeController` at `packages/orchestrator/src/health/safeModeController.ts`, `loadLayoutPack`/`validateLayoutPack` at `packages/shared/src/vision/layout-loader.ts`
