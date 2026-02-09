# Requirements Document

## Introduction

This document specifies the requirements for enabling autonomous CoinPoker cash-game play on macOS. The poker bot's decision-making brain (orchestrator, agents, solver) is already fully implemented and tested. This feature adds the final layer: macOS OS-automation to the executor, CoinPoker layout packs and template assets for the vision service, and a game loop CLI that polls vision, feeds the decision pipeline, and executes actions with safety gates.

## Glossary

- **Executor**: The component responsible for translating poker actions into OS-level automation (mouse clicks, keyboard input)
- **Vision_Service**: The Python gRPC service that captures screenshots and extracts game state using OpenCV
- **Orchestrator**: The decision-making coordinator that combines GTO solver output with agent recommendations
- **Layout_Pack**: A JSON configuration file defining regions of interest (ROIs) for a specific poker client and table size
- **Template_Asset**: A cropped image file used for template matching (buttons, cards, dealer button)
- **Game_Loop**: The continuous polling mechanism that detects turns, requests decisions, and executes actions
- **WindowManager**: The component that discovers, focuses, and manages poker client windows
- **ComplianceChecker**: The component that verifies the poker client process is running and on the allowlist before actions
- **Turn_State**: The derived state indicating whether it is the bot's turn to act
- **Hand_Fingerprint**: A unique identifier for a poker hand to prevent duplicate decisions
- **ResearchUIExecutor**: The executor implementation for live poker clients (vs simulator)
- **nut.js**: A Node.js library for cross-platform mouse and keyboard automation
- **AppleScript**: macOS scripting language for window management and process control
- **Process_Allowlist**: A list of permitted poker client process names that the bot is authorized to interact with
- **Prohibited_Process_List**: A list of poker client process names that the bot must never interact with
- **GameStateParser**: The existing class (`packages/orchestrator/src/vision/parser.ts`) that converts VisionOutput into a GameState for the decision pipeline
- **VisionClient**: The existing gRPC client (`packages/orchestrator/src/vision/client.ts`) that communicates with the Python vision service
- **validateConnectivity**: The existing startup check (`packages/orchestrator/src/startup/validateConnectivity.ts`) that verifies vision service health before operation
- **dpiCalibration**: The scaling factor in the layout pack (e.g., 2.0 for macOS Retina) used to translate vision coordinates to screen coordinates
- **fast-check**: A property-based testing library for TypeScript used to validate correctness properties with randomized inputs

## Requirements

### Requirement 1: System Inputs and Assumptions

**User Story:** As a bot operator, I want to specify target environment parameters upfront, so that the system can validate compatibility before attempting autonomous play.

#### Acceptance Criteria

1. THE System SHALL support a configurable target resolution and scaling factor for CoinPoker tables
2. THE System SHALL support configuration for table type (6-max or heads-up)
3. THE System SHALL require the CoinPoker process name to be specified in the bot configuration
4. THE System SHALL require at least one of windowTitlePatterns or processNames to be specified for window discovery
5. THE System SHALL use OpenCV template matching for button detection in the initial MVP implementation
6. THE System SHALL document the detection method in the layout pack metadata

### Requirement 2: Window Management and Process Compliance

**User Story:** As a bot operator, I want the executor to discover and focus the CoinPoker window automatically, so that actions are executed on the correct table without manual intervention.

#### Acceptance Criteria

1. WHEN the executor starts THEN THE WindowManager SHALL discover CoinPoker windows by process name and window title patterns
2. WHEN multiple CoinPoker windows exist THEN THE WindowManager SHALL select the window matching the configured title pattern
3. WHEN a CoinPoker window is found THEN THE WindowManager SHALL retrieve its screen bounds and dimensions
4. WHEN the executor needs to act THEN THE WindowManager SHALL focus the target window before executing actions
5. WHEN the window dimensions are below the configured minimum THEN THE WindowManager SHALL reject the window and return null
6. WHEN the ComplianceChecker validates the environment THEN THE System SHALL verify the CoinPoker process is running
7. WHEN the CoinPoker process is not running THEN THE ComplianceChecker SHALL fail and prevent action execution
8. WHEN the ComplianceChecker validates the environment THEN THE System SHALL verify the process name is on the configured Process_Allowlist
9. WHEN the process name is on the Prohibited_Process_List THEN THE ComplianceChecker SHALL fail and prevent action execution
10. WHERE a build flag requirement is configured THEN THE ComplianceChecker SHALL verify the flag is set before allowing action execution
11. WHEN a required build flag is not set THEN THE ComplianceChecker SHALL fail with a descriptive error message

### Requirement 3: Mouse and Keyboard Automation

**User Story:** As a bot operator, I want the executor to click action buttons and type bet amounts using OS-level automation, so that the bot can interact with CoinPoker like a human player.

#### Acceptance Criteria

1. WHEN the executor receives a fold action THEN THE System SHALL move the mouse to the fold button coordinates and click
2. WHEN the executor receives a call action THEN THE System SHALL move the mouse to the call button coordinates and click
3. WHEN the executor receives a check action THEN THE System SHALL move the mouse to the check button coordinates and click
4. WHEN the executor receives a raise action THEN THE System SHALL click the bet input field, clear existing text, type the bet amount, and click the raise button
5. WHEN typing a bet amount THEN THE System SHALL round to the configured decimal precision
6. WHEN typing a bet amount THEN THE System SHALL enforce the configured minimum raise amount
7. WHEN typing a bet amount THEN THE System SHALL use the configured decimal separator for CoinPoker
8. WHEN mouse movement is required THEN THE System SHALL use nut.js `mouse.move(straightTo(point))` with a configured speed to perform smooth, human-like cursor movement (not instant teleportation via `setPosition`)
9. WHEN keyboard input is required THEN THE System SHALL use nut.js to simulate key presses
10. WHEN executing any action THEN THE System SHALL add a random human-like delay (1–3 seconds) before clicking the action button, using the existing `deterministicRandom` helper for reproducibility
11. WHEN typing bet amounts character by character THEN THE System SHALL add random inter-keystroke delays (50–200ms) to simulate human typing speed

### Requirement 4: Vision Integration for Turn Detection

**User Story:** As a bot operator, I want the executor to use vision output to detect when it's the bot's turn, so that actions are only executed at the correct time.

#### Acceptance Criteria

1. WHEN the executor checks turn state THEN THE System SHALL query the Vision_Service for current button visibility
2. WHEN action buttons are visible and enabled in vision output THEN THE System SHALL derive that it is the bot's turn
3. WHEN action buttons are visible but marked as disabled THEN THE System SHALL treat the action as invalid, log a warning, and skip execution
4. WHEN no action buttons are visible THEN THE System SHALL derive that it is not the bot's turn
5. WHEN the Vision_Service times out on the first attempt THEN THE System SHALL retry up to the configured retry limit
6. WHEN all Vision_Service retries are exhausted THEN THE System SHALL treat the turn check as failed and abort action execution
7. WHEN vision output includes button coordinates THEN THE System SHALL use those coordinates for click targets
8. WHEN vision output is missing expected buttons THEN THE System SHALL abort action execution and log an error

### Requirement 5: Template Matching and Asset Management

**User Story:** As a vision developer, I want the Vision_Service to load template assets from layout packs, so that button detection works across different table configurations.

#### Acceptance Criteria

1. WHEN the Vision_Service starts THEN THE System SHALL load template assets from the configured layout pack directory
2. WHEN performing button detection THEN THE System SHALL use template matching with loaded button templates
3. WHEN a template match exceeds the confidence threshold THEN THE System SHALL return the button location and type
4. WHEN multiple matches are found for a button THEN THE System SHALL return the match with the highest confidence
5. WHEN no template matches exceed the threshold THEN THE System SHALL return an empty result for that button
6. WHEN template files are missing THEN THE System SHALL log an error and continue with available templates
7. WHEN deriving turn state THEN THE System SHALL check for the presence of fold, call, check, or raise button templates

### Requirement 6: CoinPoker Layout Pack Configuration

**User Story:** As a bot operator, I want a complete CoinPoker layout pack with all ROIs and templates, so that the vision service can extract game state from CoinPoker tables.

#### Acceptance Criteria

1. THE Layout_Pack SHALL define `cardROIs` for hole cards and community cards, `potROI` for pot size, `stackROIs` keyed by Position for player stacks, and `buttonROI` for the dealer button
2. THE Layout_Pack SHALL define `actionButtonROIs` (fold, check, call, raise, bet, allIn) to specify where the Vision_Service should search for buttons
3. THE Layout_Pack SHALL include `buttonTemplates` mapping action names to template image paths for fold, call, check, raise, and all-in buttons
4. THE Layout_Pack SHALL include template assets for card ranks and suits
5. THE Layout_Pack SHALL include a template asset for the dealer button
6. THE Layout_Pack SHALL specify `resolution` (width, height) and `dpiCalibration` scaling factor
7. THE Layout_Pack SHALL be stored in a JSON file following the established `LayoutPack` schema from `@poker-bot/shared`
8. THE Layout_Pack SHALL include a `version` field for compatibility checking
9. WHEN the layout pack version does not match the parser schema version THEN THE System SHALL fail with a descriptive error message
10. THE Layout_Pack SHALL include `windowPatterns` with `titleRegex` and `processName` for window discovery

### Requirement 7: Game Loop and Continuous Operation

**User Story:** As a bot operator, I want a game loop that continuously polls for turns and executes decisions, so that the bot can play autonomously without manual intervention.

#### Acceptance Criteria

1. WHEN the game loop starts THEN THE System SHALL enter a continuous polling cycle
2. WHEN polling for turns THEN THE System SHALL query the Vision_Service at the configured interval
3. WHEN it is the bot's turn THEN THE System SHALL compute a hand fingerprint from the current game state
4. WHEN the hand fingerprint matches the previous hand THEN THE System SHALL skip decision-making to avoid duplicates
5. WHEN the hand fingerprint is new THEN THE System SHALL invoke the decision pipeline and execute the recommended action
6. WHEN an action is executed THEN THE System SHALL record the hand fingerprint to prevent re-processing
7. WHEN the game loop encounters an error THEN THE System SHALL log the error and continue polling
8. WHEN a stop signal is received THEN THE System SHALL exit the polling cycle gracefully

### Requirement 8: CLI Runner for Live Mode

**User Story:** As a bot operator, I want a CLI command to start the bot in live mode, so that I can launch autonomous play with a single command.

#### Acceptance Criteria

1. WHEN the operator runs the live mode command THEN THE System SHALL load the specified bot configuration
2. WHEN the bot configuration is loaded THEN THE System SHALL initialize the Vision_Service client, Orchestrator, and Executor
3. WHEN all components are initialized THEN THE System SHALL perform a health check on the Vision_Service
4. WHEN the Vision_Service health check fails THEN THE System SHALL abort startup and exit with a descriptive error
5. WHEN the health check succeeds THEN THE System SHALL start the game loop
6. WHEN the game loop is running THEN THE System SHALL log status updates at regular intervals
7. WHEN a fatal error occurs THEN THE System SHALL shut down gracefully and exit with a non-zero status code
8. WHEN the operator sends a termination signal THEN THE System SHALL stop the game loop and clean up resources
9. THE CLI SHALL accept command-line arguments for bot config path and log level
10. THE CLI SHALL accept environment variables for Vision_Service URL, layout pack path, and log level override

### Requirement 9: Configuration Schema Extensions

**User Story:** As a bot operator, I want to configure window management and bet input settings in the bot config, so that the executor can adapt to different table layouts and client versions.

**Note:** Several of these fields already exist in the codebase. `WindowConfig` in `packages/executor/src/types.ts` already has `titlePatterns`, `processNames`, `minWindowSize`. `ComplianceConfig` already has `allowlist`, `prohibitedSites`, `requireBuildFlag`. The truly new fields are `betInputField` (extending `InputField` with formatting config) and `minRaiseAmount`.

#### Acceptance Criteria

1. THE ResearchUIConfig SHALL include a windowTitlePatterns field for window discovery
2. THE ResearchUIConfig SHALL include a processNames field for process-based compliance checking
3. THE ResearchUIConfig SHALL include a minWindowSize field to reject undersized windows
4. THE ResearchUIConfig SHALL include a `betInputField` configuration extending existing `InputField` (x, y, width, height) with `decimalPrecision` and `decimalSeparator`
5. THE ResearchUIConfig SHALL include a `minRaiseAmount` field for bet sizing validation
6. WHEN the bot config is loaded THEN THE System SHALL validate all required fields are present
7. WHEN a required field is missing THEN THE System SHALL fail with a descriptive error message
8. WHEN field values are invalid THEN THE System SHALL fail with a descriptive validation error

### Requirement 10: Operator Documentation

**User Story:** As a bot operator, I want clear documentation on running the bot in live mode, so that I can set up and troubleshoot autonomous play.

#### Acceptance Criteria

1. THE Operator_Manual SHALL document the live mode CLI command with all arguments
2. THE Operator_Manual SHALL document all required environment variables for live mode
3. THE Operator_Manual SHALL document the bot configuration schema for CoinPoker
4. THE Operator_Manual SHALL include a troubleshooting section for common issues
5. THE Operator_Manual SHALL document the expected CoinPoker window setup and table configuration
6. THE Operator_Manual SHALL document how to capture and update layout pack assets
7. THE Operator_Manual SHALL document safety mechanisms and how to stop the bot

### Requirement 11: Error Handling and Safety Gates

**User Story:** As a bot operator, I want the system to fail safely when errors occur, so that the bot never executes actions in an invalid state.

#### Acceptance Criteria

1. WHEN the WindowManager cannot find a valid window THEN THE System SHALL abort action execution and log an error
2. WHEN the ComplianceChecker detects the process is not running THEN THE System SHALL abort action execution
3. WHEN the Vision_Service times out after all retries THEN THE System SHALL abort the current decision cycle
4. WHEN the Executor fails to execute an action THEN THE System SHALL log the failure and continue to the next polling cycle
5. WHEN the decision pipeline returns an invalid action THEN THE System SHALL log an error and default to fold
6. WHEN the game loop encounters repeated failures THEN THE System SHALL increment an error counter
7. WHEN the error counter exceeds the configured threshold within the configured time window THEN THE System SHALL enter safe mode
8. WHEN safe mode is entered THEN THE System SHALL stop executing actions but continue polling for monitoring
9. THE System SHALL support a configurable error threshold count and time window for safe mode triggering
10. WHEN in safe mode THEN THE System SHALL log a critical alert and await operator intervention

### Requirement 12: Coordinate Scaling and Translation

**User Story:** As a bot operator, I want the system to correctly translate vision-derived coordinates into screen coordinates, so that mouse clicks land on the correct buttons regardless of window position or Retina scaling.

#### Acceptance Criteria

1. WHEN translating vision coordinates to screen coordinates THEN THE System SHALL apply the layout pack's `dpiCalibration` factor for macOS Retina displays
2. WHEN the poker window is repositioned THEN THE System SHALL offset button coordinates by the current window bounds (x, y)
3. WHEN the current window dimensions differ from the layout pack's `resolution` THEN THE System SHALL scale coordinates proportionally
4. WHEN computed screen coordinates fall outside the window bounds THEN THE System SHALL abort the click and log an error
5. THE coordinate translation logic SHALL be unit-testable with deterministic inputs and outputs
