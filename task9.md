# Task 9: Implement Action Executor

**Goal**: Implement the execution layer that translates StrategyDecision actions into actual poker platform commands. Create production-ready simulator and research UI executors with action verification, compliance checks, and cross-platform automation.

**Architecture**: Extend existing executor package with ActionExecutor implementations, Window Manager, and verification system. Integrate into orchestrator decision loop for seamless StrategyDecision → execution pipeline.

---

## Prerequisites

- Task 1-8 completed (Strategy Engine returns StrategyDecision objects)
- Existing executor package structure (packages/executor/src/ with index.ts, simulators/, research_bridge.ts, verifier.ts)
- Orchestrator main.ts has working makeDecision() function
- Vision system operational for action verification
- StrategyDecision type available from @poker-bot/shared (moved in §9.0.1)

---

## 9.0 Move Strategy Types to Shared

### 9.0.1 Move StrategyDecision to Shared Package

**File**: `packages/shared/src/strategy.ts` (create new)

```typescript
import type { Action, ActionKey } from './types';

export interface StrategyConfig {
  alphaGTO: number;  // [0.3, 0.9] - GTO weight in blend
  betSizingSets: {
    preflop: number[];
    flop: number[];
    turn: number[];
    river: number[];
  };
  divergenceThresholdPP: number;  // Log when GTO vs agents differ >30pp
  rngSeed?: number;  // For deterministic replay
}

export interface BlendedDistribution {
  actions: Map<ActionKey, number>;
  alpha: number;
  gtoWeight: number;
  agentWeight: number;
}

export interface StrategyDecision {
  action: Action;
  reasoning: {
    gtoRecommendation: Map<ActionKey, number>;
    agentRecommendation: Map<ActionKey, number>;
    blendedDistribution: Map<ActionKey, number>;
    alpha: number;
    divergence: number;
    riskCheckPassed: boolean;
    sizingQuantized: boolean;
  };
  timing: {
    gtoTime: number;
    agentTime: number;
    synthesisTime: number;
    totalTime: number;
  };
  metadata: {
    rngSeed: number;
    configSnapshot: StrategyConfig;
    riskSnapshot?: any;  // From risk controller
  };
}
```

**File**: `packages/shared/src/index.ts` (modify existing)

```typescript
export * from './strategy';
```

**File**: `packages/orchestrator/src/strategy/types.ts` (modify existing)

```typescript
// Remove StrategyDecision, StrategyConfig, BlendedDistribution from here
// Keep orchestrator-specific types only
// Re-export from shared:
export type { StrategyDecision, StrategyConfig, BlendedDistribution } from '@poker-bot/shared';
```

**Additional Files to Update**: All files currently importing from `./strategy/types` need to be updated. Check all helpers under `packages/orchestrator/src/strategy/**/*.ts`:

- **`packages/orchestrator/src/strategy/engine.ts`** - Change import to `@poker-bot/shared`
- **`packages/orchestrator/src/strategy/blending.ts`** - Change import to `@poker-bot/shared`
- **`packages/orchestrator/src/strategy/selection.ts`** - Change import to `@poker-bot/shared`
- **`packages/orchestrator/src/strategy/sizing.ts`** - Change import to `@poker-bot/shared`
- **`packages/orchestrator/src/strategy/divergence.ts`** - Change import to `@poker-bot/shared`
- **`packages/orchestrator/src/strategy/fallbacks.ts`** - Change import to `@poker-bot/shared`
- **`packages/orchestrator/src/safety/risk.ts`** - Change import to `@poker-bot/shared` (if used)
- **`packages/orchestrator/test/strategy/*.spec.ts`** - Update all test imports (double-check none still import from old path)
- **`packages/orchestrator/src/main.ts`** - Update import for StrategyDecision

**After Migration**: Regenerate shared type barrels and update dependencies:
- **`packages/shared/src/index.ts`** - Ensure strategy types are exported
- **`packages/orchestrator/package.json`** - May need explicit dependency on `@poker-bot/shared` if not already present

---

## 9.1 Create Simulator/API Executor

### 9.1.1 Define Execution Interfaces

**File**: `packages/executor/src/types.ts` (create new)

```typescript
import type { Action, StrategyDecision } from "@poker-bot/shared";

export interface ExecutionResult {
  success: boolean;
  actionExecuted?: Action;
  error?: string;
  verificationResult?: VerificationResult;
  timing: {
    executionMs: number;
    verificationMs?: number;
    totalMs: number;
  };
  metadata: {
    executionMode: ExecutionMode;
    platform?: string;
    windowHandle?: string;
  };
}

export interface VerificationResult {
  passed: boolean;
  expectedState?: any;
  actualState?: any;
  mismatchReason?: string;
  retryCount: number;
}

export type ExecutionMode = 'simulator' | 'api' | 'research-ui';

export interface ActionExecutor {
  execute(decision: StrategyDecision, options?: ExecutionOptions): Promise<ExecutionResult>;
  verify?(result: ExecutionResult): Promise<VerificationResult>;
}

export interface ExecutionOptions {
  verifyAction?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface SimulatorCommand {
  action: string;
  amount?: number;
  position?: string;
}

export interface APIResponse {
  success: boolean;
  error?: string;
  executionId?: string;
}

export interface WindowHandle {
  id: string | number;
  title: string;
  processName: string;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowConfig {
  titlePatterns: string[];
  processNames: string[];
  minWindowSize: { width: number; height: number };
}

export interface ComplianceConfig {
  allowlist: string[];
  prohibitedSites: string[];
  requireBuildFlag: boolean;
}

export interface ComplianceResult {
  allowed: boolean;
  reason?: string;
  violations: string[];
}

export interface ExecutorConfig {
  enabled: boolean;
  mode: ExecutionMode;
  verifyActions: boolean;
  maxRetries: number;
  verificationTimeoutMs: number;
  simulatorEndpoint?: string;
  researchUI?: ComplianceConfig;
}
```

### 9.1.2 Implement Simulator Executor

**File**: `packages/executor/src/simulators/simulator.ts` (modify existing)

```typescript
import type { ActionExecutor, ExecutionResult, ExecutionOptions } from '../types';
import type { StrategyDecision } from '@poker-bot/shared'; // Now available after §9.0.1
import type { ActionVerifier } from '../verifier';

export class SimulatorExecutor implements ActionExecutor {
  constructor(
    private apiEndpoint?: string,
    private verifier?: ActionVerifier
  ) {}

  async execute(decision: StrategyDecision, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Translate StrategyDecision.action to simulator API call
      const apiCommand = this.translateToSimulatorCommand(decision.action);

      // Execute via API call
      const response = await this.callSimulatorAPI(apiCommand, options.timeoutMs || 5000);

      const executionTime = Date.now() - startTime;

      // Optional verification
      let verificationResult: VerificationResult | undefined;
      if (options.verifyAction && this.verifier && response.success) {
        verificationResult = await this.verifier.verifyAction(
          decision.action,
          this.predictStateChanges(decision),
          options.timeoutMs
        );
      }

      return {
        success: response.success,
        actionExecuted: decision.action,
        verificationResult,
        timing: {
          executionMs: executionTime,
          verificationMs: verificationResult ? Date.now() - startTime - executionTime : undefined,
          totalMs: Date.now() - startTime
        },
        metadata: {
          executionMode: 'simulator',
          platform: 'simulator'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown execution error',
        timing: {
          executionMs: Date.now() - startTime,
          totalMs: Date.now() - startTime
        },
        metadata: { executionMode: 'simulator' }
      };
    }
  }

  private translateToSimulatorCommand(action: Action): SimulatorCommand {
    // Implementation: convert Action to simulator-specific command format
  }

  private async callSimulatorAPI(command: SimulatorCommand, timeoutMs: number): Promise<APIResponse> {
    // Implementation: make HTTP/WebSocket call to simulator
  }
  private predictStateChanges(decision: StrategyDecision): StateChange[] {
    // Implementation detail for verification expectation
  }
}
```

### 9.1.3 Create Executor Factory

**File**: `packages/executor/src/index.ts` (modify existing)

Replace the existing stub with:

```typescript
import { SimulatorExecutor } from './simulators/simulator';
import { ResearchUIExecutor } from './research_bridge';
import type { ActionExecutor, ExecutionMode, ExecutorConfig } from './types';

export function createActionExecutor(
  mode: ExecutionMode,
  config?: ExecutorConfig,
  windowManager?: WindowManager,
  complianceChecker?: ComplianceChecker
): ActionExecutor {
  switch(mode) {
    case 'simulator':
      return new SimulatorExecutor(config?.simulatorEndpoint);
    case 'research-ui':
      if (!windowManager || !complianceChecker) {
        throw new Error('WindowManager and ComplianceChecker required for research-ui mode');
      }
      return new ResearchUIExecutor(windowManager, complianceChecker);
    case 'api':
      // Future: implement direct API executor
      throw new Error('API executor not yet implemented');
    default:
      throw new Error(`Unknown execution mode: ${mode}`);
  }
}

export * from './types';
// EXECUTOR_OK placeholder removed - replaced with working implementation
```

### 9.1.4 Add Bet Sizing Input Handler

**File**: `packages/executor/src/bet_input_handler.ts` (create new)

**Note**: Relies on pre-quantized amounts from StrategyEngine (sizing already done in `packages/orchestrator/src/strategy/sizing.ts`). This module only handles UI input mechanics.

```typescript
import type { Action } from '@poker-bot/shared';

export class BetInputHandler {
  constructor(private windowManager: WindowManager) {}

  // Handle bet sizing input fields for research UI
  async inputBetAmount(action: Action, windowHandle: WindowHandle): Promise<void> {
    if (action.type !== 'raise') return;

    // Find bet sizing input field using window manager
    const inputField = await this.locateBetInputField(windowHandle);

    // Input the pre-calculated amount (sizing already done in strategy layer)
    const amount = action.amount || 0;
    await this.typeBetAmount(inputField, amount);
  }

  private async locateBetInputField(windowHandle: WindowHandle): Promise<InputField> {
    // Use window manager to find bet input field coordinates
    // Could integrate with vision system for dynamic detection
  }

  private async typeBetAmount(inputField: InputField, amount: number): Promise<void> {
    // Cross-platform keyboard input simulation
    // Handle decimal formatting, clear existing text, etc.
  }
}

interface InputField {
  x: number;
  y: number;
  width: number;
  height: number;
}
```


---

## 9.2 Add Research UI Mode with Compliance Checks

### 9.2.1 Implement Window Manager

**File**: `packages/executor/src/window_manager.ts` (create new)

```typescript
import type { ScreenCoords, ROI } from '@poker-bot/shared';

export class WindowManager {
  constructor(private config: WindowConfig) {}

  // OS-specific window detection (Windows EnumWindows, Linux xdotool)
  async findPokerWindow(): Promise<WindowHandle | null> {
    // Validate against process names and titles
    // Return window handle or null
  }

  // Convert ROI coordinates to screen space
  roiToScreenCoords(roi: ROI, windowBounds: WindowBounds): ScreenCoords {
    // Handle DPI scaling and coordinate transformation
  }

  // Focus window for automation
  async focusWindow(handle: WindowHandle): Promise<boolean> {
    // Cross-platform window focus
  }
}
```

### 9.2.2 Implement Compliance Checker

**File**: `packages/executor/src/compliance.ts` (create new)

```typescript
export class ComplianceChecker {
  constructor(private config: ComplianceConfig) {}

  // Validate environment against allowlist
  async checkEnvironment(): Promise<ComplianceResult> {
    // Check running processes, open windows
    // Verify no prohibited sites/applications
  }

  // Gate research UI behind build flag
  isResearchUIModeAllowed(): boolean {
    // Check RESEARCH_UI_ENABLED environment variable (default false)
    return process.env.RESEARCH_UI_ENABLED === 'true';
  }

  // Runtime compliance validation
  async validateExecution(decision: StrategyDecision): Promise<boolean> {
    // Additional checks before executing actions
  }
}
```

### 9.2.3 Enhance Research UI Executor

**File**: `packages/executor/src/research_bridge.ts` (modify existing)

Replace the existing stub with:

```typescript
import { WindowManager } from './window_manager';
import { ComplianceChecker } from './compliance';
import type { ActionExecutor, ExecutionResult } from './types';

export class ResearchUIExecutor implements ActionExecutor {
  constructor(
    private windowManager: WindowManager,
    private complianceChecker: ComplianceChecker,
    private verifier?: ActionVerifier
  ) {}

  async execute(decision: StrategyDecision): Promise<ExecutionResult> {
    // Compliance check first
    const complianceResult = await this.complianceChecker.validateExecution(decision);
    if (!complianceResult) {
      return this.createFailureResult('Compliance check failed');
    }

    // Find and focus poker window
    const windowHandle = await this.windowManager.findPokerWindow();
    if (!windowHandle) {
      return this.createFailureResult('Poker window not found');
    }

    // Execute action via OS automation
    const result = await this.performAction(decision.action, windowHandle);

    if (result.success && this.verifier) {
      result.verificationResult = await this.verifier.verifyAction(
        decision.action,
        this.predictStateChanges(decision),
        decision.metadata?.configSnapshot?.execution?.verificationTimeoutMs ?? 2000
      );
    }
    return result;
  }

  private async performAction(action: Action, window: WindowHandle): Promise<ExecutionResult> {
    // Cross-platform mouse/keyboard automation
    // Handle bet sizing input fields
    // Turn waiting logic with timeouts
  }
  private predictStateChanges(decision: StrategyDecision): StateChange[] {
    // Implementation detail for verification expectation
  }
}
```

---

## 9.3 Implement Action Verification

### 9.3.1 Create Action Verifier

**File**: `packages/executor/src/verifier.ts` (modify existing)

Replace the existing stub with:

```typescript
import type { GameState, VisionOutput } from '@poker-bot/shared';
import type { ExecutionResult, VerificationResult } from './types';

// Define interface for vision client to avoid cross-package dependencies
interface VisionClientInterface {
  captureAndParse(): Promise<VisionOutput>;
}

export class ActionVerifier {
  constructor(private visionClient: VisionClientInterface) {}

  async verifyAction(
    executedAction: Action,
    expectedStateChanges: StateChange[],
    timeoutMs: number = 2000
  ): Promise<VerificationResult> {
    // Capture post-action frame
    const visionOutput = await this.visionClient.captureAndParse();

    // Parse to GameState
    const actualState = await this.parseVisionOutput(visionOutput);

    // Compare with expected state changes
    return this.compareStates(expectedStateChanges, actualState);
  }

  private compareStates(expected: StateChange[], actual: GameState): VerificationResult {
    // Strict equality rules for expected vs actual state
    // Handle partial fills and adjustments
    // Return detailed mismatch reasons
  }

  async retryOnMismatch(
    result: ExecutionResult,
    maxRetries: number = 1
  ): Promise<ExecutionResult> {
    // Re-evaluate once on mismatch with bounded retry
    // Halt on persistent failures
  }
}

interface StateChange {
  type: 'pot_increase' | 'stack_decrease' | 'action_taken';
  amount?: number;
  position?: Position;
}
```

### 9.3.2 Integrate Verification into Executor Classes

Update each ActionExecutor implementation to include verification:

```typescript
// In SimulatorExecutor.execute():
if (options.verifyAction && this.verifier) {
  const verification = await this.verifier.verifyAction(
    result.actionExecuted!,
    this.predictStateChanges(decision),
    options.timeoutMs || 2000
  );

  result.verificationResult = verification;

  // Retry logic for verification failures
  if (!verification.passed && (result.retryCount || 0) < (options.maxRetries || 1)) {
    return this.retryExecution(decision, result, verification);
  }
}

private predictStateChanges(decision: StrategyDecision): StateChange[] {
  // Predict expected state changes from decision
}
```

**Note**: No separate ActionExecutor class needed - verification is integrated directly into each ActionExecutor implementation (SimulatorExecutor, ResearchUIExecutor).
```

---

## 9.4 Consume Existing Vision Action Button Support

**Note**: Action button and turn state detection already exist from Task 3 in `packages/shared/src/vision/types.ts` and `proto/vision.proto`. Task 9 focuses on consuming these existing capabilities rather than implementing new button detection.

### 9.4.1 Integrate with Existing Vision Button Types

**File**: `packages/executor/src/window_manager.ts` (modify existing)

Update WindowManager to use existing vision types and consume vision output:

```typescript
import type { ButtonInfo, VisionOutput } from '@poker-bot/shared';

export class WindowManager {
  constructor(private config: WindowConfig) {}

  // Convert vision button coordinates to screen space
  buttonToScreenCoords(buttonInfo: ButtonInfo, windowBounds: WindowBounds): ScreenCoords {
    // Convert from vision coordinates to absolute screen coordinates
    // Handle window positioning and DPI scaling
    // Use existing ButtonInfo.screenCoords from vision system
  }

  // Validate button is actionable (enabled, visible, sufficient confidence)
  isButtonActionable(buttonInfo: ButtonInfo, minConfidence: number = 0.8): boolean {
    return buttonInfo.isEnabled && buttonInfo.isVisible && buttonInfo.confidence >= minConfidence;
  }

  // Find best action button from vision output
  findActionButton(visionOutput: VisionOutput, actionType: string): ButtonInfo | null {
    const buttons = visionOutput.actionButtons;
    if (!buttons) return null;

    const button = buttons[actionType as keyof typeof buttons];
    return button && this.isButtonActionable(button) ? button : null;
  }
}
```

### 9.4.2 Consume Turn State Information

**File**: `packages/executor/src/research_bridge.ts` (modify existing)

Update ResearchUIExecutor to use existing turn state detection:

```typescript
export class ResearchUIExecutor implements ActionExecutor {
  async execute(decision: StrategyDecision): Promise<ExecutionResult> {
    // ... existing compliance checks ...

    // Check turn state from vision output
    const turnState = await this.getCurrentTurnState();
    if (!turnState?.isHeroTurn) {
      return this.createFailureResult('Not hero\'s turn');
    }

    // Use existing action button coordinates
    const actionButton = await this.findActionButton(decision.action.type);
    if (!actionButton) {
      return this.createFailureResult(`Action button ${decision.action.type} not found or not actionable`);
    }

    // Execute using button coordinates
    return this.clickActionButton(actionButton, decision.action);
  }

  private async getCurrentTurnState(): Promise<VisionOutput['turnState']> {
    // Get turn state from existing vision system
    const visionOutput = await this.visionClient.captureAndParse();
    return visionOutput.turnState;
  }

  private async findActionButton(actionType: string): Promise<ButtonInfo | null> {
    const visionOutput = await this.visionClient.captureAndParse();
    return this.windowManager.findActionButton(visionOutput, actionType);
  }
}
```

### 9.4.3 Document Vision Quality Considerations

**Current State**: Action button detection exists but may have quality gaps:
- Button confidence scoring may need tuning for edge cases
- Turn state detection may miss some UI variations
- Screen coordinate conversion may need refinement for different resolutions

**Future Improvements** (not part of Task 9):
- Enhance button detection models if confidence scores are insufficient
- Add fallback button detection methods
- Improve turn state recognition across different poker clients

**For Task 9**: Consume existing vision capabilities and note any reliability issues for future enhancement.


---

## 9.5 Wire into Orchestrator

### 9.5.1 Update Main Decision Loop

**File**: `packages/orchestrator/src/main.ts` (modify existing)

**API Change**: `makeDecision()` now returns `{ decision: StrategyDecision, execution?: ExecutionResult }` to include execution results when enabled.

```typescript
// In run() function, create executor instance:
const executionConfig = configManager.get<ExecutorConfig>("execution");

// For research-ui mode, instantiate WindowManager and ComplianceChecker locally
let windowManager: WindowManager | undefined;
let complianceChecker: ComplianceChecker | undefined;

if (executionConfig.mode === 'research-ui') {
  const windowConfig: WindowConfig = {
    titlePatterns: executionConfig.researchUI?.allowlist || [],
    processNames: [], // Could be derived from allowlist
    minWindowSize: { width: 800, height: 600 }
  };
  const complianceConfig: ComplianceConfig = {
    allowlist: executionConfig.researchUI?.allowlist || [],
    prohibitedSites: executionConfig.researchUI?.prohibitedSites || [],
    requireBuildFlag: executionConfig.researchUI?.requireBuildFlag ?? true
  };

  windowManager = new WindowManager(windowConfig);
  complianceChecker = new ComplianceChecker(complianceConfig);
}

const actionExecutor = executionConfig.enabled
  ? createActionExecutor(executionConfig.mode, executionConfig, windowManager, complianceChecker)
  : null;

// In makeDecision() function:
async function makeDecision(state: GameState, options: DecisionOptions = {}): Promise<{
  decision: StrategyDecision;
  execution?: ExecutionResult;
}> {
  const tracker = ensureTracker(options.tracker);

  // ... existing GTO/agent decision logic ...

  // After StrategyEngine.decide() call:
  const strategyDecision = strategyEngine.decide(state, gto, agents);

  // NEW: Execute the decision if execution is enabled
  let executionResult: ExecutionResult | undefined;
  if (actionExecutor && executionConfig.enabled) {
    // Reserve time for execution in budget tracker
    if (tracker.shouldPreempt("execution")) {
      console.warn("Execution preempted due to time budget");
    } else {
      tracker.startComponent("execution");
      try {
        executionResult = await actionExecutor.execute(strategyDecision, {
          verifyAction: executionConfig.verifyActions,
          maxRetries: executionConfig.maxRetries,
          timeoutMs: executionConfig.verificationTimeoutMs
        });
      } finally {
        tracker.endComponent("execution");
      }
    }
  }

  // Return enhanced result with execution results
  return {
    decision: strategyDecision,
    execution: executionResult
  };
}
```

**Budget Integration**: Execution uses TimeBudgetTracker with dedicated "execution" component allocation. If execution would exceed remaining budget, it gets preempted.

**Error Handling**: Execution failures are logged but don't prevent returning the decision. Risk controller continues to handle safety regardless of execution success.

### 9.5.2 Add Executor to Orchestrator Exports

**File**: `packages/orchestrator/src/index.ts` (modify existing)

```typescript
export { createActionExecutor } from '@poker-bot/executor';
export type { ExecutionResult, ExecutionMode, ExecutionOptions } from '@poker-bot/executor';
```

**Dependency Requirement**: Ensure `packages/orchestrator/package.json` includes:
```json
{
  "dependencies": {
    "@poker-bot/executor": "workspace:*",
    "@poker-bot/shared": "workspace:*"
  }
}
```

**Note**: Orchestrator must instantiate WindowManager/ComplianceChecker locally for research-ui mode and pass them as separate parameters to `createActionExecutor`.

---

## 9.6 Add Configuration Support

### 9.6.1 Extend Bot Config Schema

**File**: `config/schema/bot-config.schema.json` (modify existing)

Extend the existing execution section with additional properties:

```json
{
  "execution": {
    "type": "object",
    "properties": {
      "enabled": { "type": "boolean", "default": false },
      "mode": { "enum": ["simulator", "api", "research-ui"], "default": "simulator" },
      "verifyActions": { "type": "boolean", "default": true },
      "maxRetries": { "type": "integer", "default": 1 },
      "verificationTimeoutMs": { "type": "integer", "default": 2000 },
      "simulatorEndpoint": { "type": "string" },
      "researchUI": {
        "type": "object",
        "properties": {
          "allowlist": { "type": "array", "items": { "type": "string" } },
          "prohibitedSites": { "type": "array", "items": { "type": "string" } },
          "requireBuildFlag": { "type": "boolean", "default": true }
        }
      }
    }
  }
}
```

### 9.6.2 Update Default Config

**File**: `config/bot/default.bot.json` (modify existing)

Extend the existing execution section:

```json
{
  "execution": {
    "enabled": false,
    "mode": "simulator",
    "verifyActions": true,
    "maxRetries": 1,
    "verificationTimeoutMs": 2000,
    "researchUI": {
      "allowlist": ["pokerstars", "ggpoker"],
      "prohibitedSites": ["bet365", "williamhill"],
      "requireBuildFlag": true
    }
  }
}
```

### 9.6.3 Update Protobuf Definitions

**Note**: Vision protobuf definitions already exist from Task 3. If `proto/executor.proto` is added, run `pnpm run proto:gen` to regenerate TypeScript bindings and add the actual service implementation (currently no executor service exists). For initial implementation, the executor can work without a separate gRPC service.

**File**: `proto/executor.proto` (create new if needed)

```protobuf
service ExecutorService {
  rpc ExecuteAction(ExecuteRequest) returns (ExecuteResponse);
}

message ExecuteRequest {
  StrategyDecision decision = 1;
  ExecutionOptions options = 2;
}

message ExecuteResponse {
  ExecutionResult result = 1;
}

message ExecutionOptions {
  bool verify_action = 1;
  int32 max_retries = 2;
  int32 timeout_ms = 3;
}

message ExecutionResult {
  bool success = 1;
  Action action_executed = 2;
  string error = 3;
  VerificationResult verification_result = 4;
  TimingData timing = 5;
  Metadata metadata = 6;
}
```

**After proto changes**: Run `pnpm run proto:gen` to regenerate TypeScript bindings from updated protobuf files.

---

## 9.7 Create Comprehensive Tests

### 9.7.1 Unit Tests

**Files**: `packages/executor/test/*.spec.ts`

- `simulator.spec.ts` - SimulatorExecutor API calls and execution logic
- `window_manager.spec.ts` - Window detection and coordinate conversion
- `verifier.spec.ts` - Action verification logic and state comparison
- `compliance.spec.ts` - Environment validation and build flag checks
- `bet_input_handler.spec.ts` - UI input field handling
- `research_bridge.spec.ts` - ResearchUIExecutor automation

### 9.7.2 Integration Tests

**File**: `packages/orchestrator/test/execution/integration.spec.ts`

```typescript
describe("Action Executor Integration", () => {
  it("executes StrategyDecision through full pipeline", async () => {
    // Test: StrategyDecision → ActionExecutor → Verification → Result
  });

  it("handles verification failures with retry", async () => {
    // Test retry logic on state mismatch
  });

  it("respects compliance checks in research UI mode", async () => {
    // Test environment validation
  });
});
```

### 9.7.3 End-to-End Tests

**File**: `packages/orchestrator/test/e2e/execution.spec.ts`

```typescript
describe("End-to-End Execution", () => {
  it("completes full decision-to-execution cycle", async () => {
    // Vision → Parser → GTO → Agents → Strategy → Execution → Verification
  });
});
```

---

## Success Criteria

Task 9 is complete when:
1. Simulator executor translates StrategyDecision to API calls with verification
2. Research UI executor provides cross-platform automation with compliance checks
3. Action verification captures post-execution state and handles mismatches
4. Window manager detects poker windows and converts coordinates accurately
5. Vision system detects action buttons and turn state
6. Bet sizing precision handles input fields correctly
7. All unit and integration tests pass
8. No compilation or linting errors
9. Full end-to-end pipeline works from vision to verified execution

---

## Notes

- Start with simulator mode for safe development/testing
- Research UI mode requires --research-ui build flag (default off)
- All execution respects 2-second deadline from Task 6
- Verification uses existing vision system for state capture
- Compliance checks prevent execution on prohibited platforms
- Window manager handles DPI scaling and coordinate transformation
- Action verification includes bounded retry logic
- Configuration supports all execution modes and safety settings
