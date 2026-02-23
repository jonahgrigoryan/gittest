import { WindowManager } from './window_manager';
import { ComplianceChecker } from './compliance';
import { BetInputHandler } from './bet_input_handler';
import type { ActionExecutor, ExecutionResult, ExecutionOptions, ResearchUIConfig } from './types';
import type { StrategyDecision } from '@poker-bot/shared';
import type {
  ActionVerifier,
  VisionClientInterface,
  VisionOutput,
} from './verifier';
import { deterministicRandom } from './rng';
import { InputAutomation, type CoordinateContext } from './input_automation';

interface WindowHandle {
  id: string | number;
  title: string;
  processName: string;
}

type VisionActionButton = {
  screenCoords: {
    x: number;
    y: number;
  };
  isEnabled: boolean;
  isVisible: boolean;
  confidence: number;
  text?: string;
};

interface StateChange {
  type: 'pot_increase' | 'stack_decrease' | 'action_taken';
  amount?: number;
  position?: string;
}

const DEFAULT_LAYOUT_RESOLUTION = { width: 1920, height: 1080 } as const;
const MIN_ACTION_BUTTON_CONFIDENCE = 0.8;

interface ResearchUIExecutorDependencies {
  inputAutomation?: InputAutomation;
  betInputHandler?: BetInputHandler;
  layoutResolution?: { width: number; height: number };
  dpiCalibration?: number;
  visionClient?: VisionClientInterface;
}

/**
 * Production-grade Research UI Executor for cross-platform OS automation.
 * Handles poker GUI interaction with compliance checks and safety measures.
 */
export class ResearchUIExecutor implements ActionExecutor {
  private readonly windowManager: WindowManager;
  private readonly complianceChecker: ComplianceChecker;
  private readonly inputAutomation: InputAutomation;
  private readonly betInputHandler: BetInputHandler;
  private readonly verifier?: ActionVerifier;
  private readonly researchUIConfig?: ResearchUIConfig;
  private readonly visionClient?: VisionClientInterface;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  private readonly layoutResolution: { width: number; height: number };
  private readonly dpiCalibration: number;
  private jitterCounter = 0;

  constructor(
    windowManager: WindowManager,
    complianceChecker: ComplianceChecker,
    verifier?: ActionVerifier,
    researchUIConfig?: ResearchUIConfig,
    logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console,
    dependencies: ResearchUIExecutorDependencies = {}
  ) {
    this.windowManager = windowManager;
    this.complianceChecker = complianceChecker;
    this.researchUIConfig = researchUIConfig;
    this.verifier = verifier;
    this.visionClient = dependencies.visionClient;
    this.logger = logger;
    this.layoutResolution = dependencies.layoutResolution ?? DEFAULT_LAYOUT_RESOLUTION;
    this.dpiCalibration = dependencies.dpiCalibration ?? 1;

    const initialContext: CoordinateContext = {
      dpiCalibration: this.dpiCalibration,
      layoutResolution: this.layoutResolution,
      windowBounds: {
        x: 0,
        y: 0,
        width: this.layoutResolution.width,
        height: this.layoutResolution.height
      }
    };

    this.inputAutomation =
      dependencies.inputAutomation ??
      new InputAutomation(initialContext, this.windowManager, this.logger);

    this.betInputHandler =
      dependencies.betInputHandler ??
      new BetInputHandler(researchUIConfig, logger, this.inputAutomation);
  }

  /**
   * Executes a StrategyDecision through OS-level automation
   */
  async execute(decision: StrategyDecision, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      this.logger.debug('ResearchUIExecutor: Starting execution', {
        action: decision.action,
        options
      });

      // 0. Early validation for raise amount
      if (decision.action.type === 'raise') {
        if (decision.action.amount === undefined || !Number.isFinite(decision.action.amount) || decision.action.amount <= 0) {
          const error = `Invalid raise amount: ${decision.action.amount}`;
          this.logger.error('ResearchUIExecutor: ' + error);
          return this.createFailureResult(error, startTime);
        }
      }

      // 1. Compliance check first
      const complianceResult = await this.complianceChecker.validateExecution(decision);
      if (!complianceResult) {
        const error = 'Compliance check failed';
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      // 2. Find and focus poker window
      const windowHandle = await this.windowManager.findPokerWindow();
      if (!windowHandle) {
        const error = 'Poker window not found';
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      // 3. Validate and focus window
      const windowBounds = await this.windowManager.getWindowBounds(windowHandle);
      if (!this.windowManager.validateWindow(windowHandle, windowBounds)) {
        const error = 'Window validation failed';
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      const focusSuccess = await this.windowManager.focusWindow(windowHandle);
      if (!focusSuccess) {
        const error = 'Failed to focus window';
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      const focusedWindowBounds = await this.windowManager.getWindowBounds(windowHandle);
      if (!this.windowManager.validateWindow(windowHandle, focusedWindowBounds)) {
        const error = 'Window validation failed after focus';
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      this.inputAutomation.updateCoordinateContext(this.createCoordinateContext(focusedWindowBounds));
      this.inputAutomation.updateRandomSeed(decision.metadata?.rngSeed ?? 0);

      // 4. Check turn state
      const visionOutput = await this.captureVisionSnapshot();
      const isHeroTurn = this.isHeroTurn(visionOutput);
      if (!isHeroTurn) {
        const error = 'Not hero\'s turn';
        this.logger.warn('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      this.logger.debug('ResearchUIExecutor: Turn state validated', {
        turnState: visionOutput.turnState,
        fallbackUsed: visionOutput.turnState ? this.isValidTurnState(visionOutput.turnState) === false : true,
      });

      // 5. Find and validate action button
      const actionButtonResult = this.selectActionButton(
        visionOutput,
        decision.action.type
      );

      if (actionButtonResult.state === 'missing') {
        const error = `Action button ${decision.action.type} not found`;
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      if (actionButtonResult.state === 'disabled') {
        const error = `Action button ${decision.action.type} is not actionable`;
        this.logger.warn('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      const actionButton = actionButtonResult.button;

      this.logger.debug('ResearchUIExecutor: Action button found', {
        actionType: decision.action.type,
        button: actionButton
      });

      const screenCoords = this.resolveScreenButton(actionButton, focusedWindowBounds);

      // 6. Execute action via OS automation
      const executionTime = Date.now() - startTime;
      const actionResult = await this.performAction(
        decision,
        screenCoords,
        windowHandle,
        focusedWindowBounds
      );

      if (!actionResult.success) {
        return actionResult;
      }

      // 7. Optional verification
      let verificationResult = actionResult.verificationResult;
      if (options.verifyAction && this.verifier && actionResult.success) {
        this.logger.debug('ResearchUIExecutor: Starting verification');

        const verifyStartTime = Date.now();
        const expectedChanges = this.predictStateChanges(decision);

        verificationResult = await this.verifier.verifyAction(
          decision.action,
          expectedChanges,
          Math.max(1000, (options.timeoutMs || 5000) - executionTime)
        );

        const verifyTime = Date.now() - verifyStartTime;

        this.logger.debug('ResearchUIExecutor: Verification complete', {
          passed: verificationResult.passed,
          verifyTime
        });

        // Retry logic for verification failures
        if (!verificationResult.passed) {
          if ((options.maxRetries || 0) > 0) {
            this.logger.warn('ResearchUIExecutor: Verification failed, retrying', {
              retryCount: 1,
              reason: verificationResult.mismatchReason
            });

            const retryResult = await this.retryExecution(decision, options);
            return retryResult;
          } else {
             // Verification failed and no retries left
             const totalTime = Date.now() - startTime;
             return {
               success: false,
               error: `Verification failed: ${verificationResult.mismatchReason}`,
               actionExecuted: decision.action,
               verificationResult,
               timing: {
                 executionMs: executionTime,
                 verificationMs: totalTime - executionTime,
                 totalMs: totalTime
               },
               metadata: {
                 executionMode: 'research-ui',
                 platform: windowHandle.processName,
                 windowHandle: windowHandle.id.toString()
               }
             };
          }
        }
      }

      const totalTime = Date.now() - startTime;

      return {
        success: true,
        actionExecuted: decision.action,
        verificationResult,
        timing: {
          executionMs: executionTime,
          verificationMs: verificationResult ? totalTime - executionTime : undefined,
          totalMs: totalTime
        },
        metadata: {
          executionMode: 'research-ui',
          platform: windowHandle.processName,
          windowHandle: windowHandle.id.toString()
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';
      this.logger.error('ResearchUIExecutor: Execution failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        timing: {
          executionMs: Date.now() - startTime,
          totalMs: Date.now() - startTime
        },
        metadata: { executionMode: 'research-ui' }
      };
    }
  }

  /**
   * Performs the actual action via OS-level automation
   */
  private async performAction(
    decision: StrategyDecision,
    screenCoords: { x: number; y: number },
    windowHandle: WindowHandle,
    windowBounds: { x: number; y: number; width: number; height: number }
  ): Promise<ExecutionResult> {
    const action = decision.action;
    this.logger.debug('ResearchUIExecutor: Performing action', {
      action,
      screenCoords,
      windowHandle
    });

    try {
      this.inputAutomation.updateCoordinateContext(this.createCoordinateContext(windowBounds));

      // For raise actions: input amount first, then click the raise button.
      if (action.type === 'raise' && action.amount !== undefined) {
        this.logger.debug('ResearchUIExecutor: Handling bet sizing');
        await this.betInputHandler.inputBetAmount(action, windowHandle, decision.metadata?.rngSeed);
      }

      await this.inputAutomation.clickScreenCoords(
        screenCoords.x,
        screenCoords.y
      );
      this.logger.info('ResearchUIExecutor: Clicked action button', {
        action: action.type,
        coordinates: screenCoords
      });

      return {
        success: true,
        actionExecuted: action,
        timing: {
          executionMs: 0, // Will be set by caller
          totalMs: 0
        },
        metadata: {
          executionMode: 'research-ui',
          platform: windowHandle.processName,
          windowHandle: windowHandle.id.toString()
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('ResearchUIExecutor: Action execution failed', { error: errorMessage });

      return {
        success: false,
        error: `Action execution failed: ${errorMessage}`,
        timing: {
          executionMs: 0,
          totalMs: 0
        },
        metadata: { executionMode: 'research-ui' }
      };
    }
  }

  /**
   * Captures a single shared vision snapshot for this execution cycle.
   */
  private async captureVisionSnapshot(): Promise<VisionOutput> {
    if (!this.visionClient) {
      throw new Error("Vision client not configured");
    }
    return this.visionClient.captureAndParse();
  }

  /**
   * Derives hero turn from explicit turn state when valid, otherwise
   * uses the action button fallback.
   */
  private isHeroTurn(visionOutput: VisionOutput): boolean {
    if (visionOutput.turnState && this.isValidTurnState(visionOutput.turnState)) {
      return visionOutput.turnState.isHeroTurn;
    }

    return (
      this.countEnabledVisibleButtons(visionOutput.actionButtons?.fold) +
      this.countEnabledVisibleButtons(visionOutput.actionButtons?.check) +
      this.countEnabledVisibleButtons(visionOutput.actionButtons?.call) +
      this.countEnabledVisibleButtons(visionOutput.actionButtons?.raise) +
      this.countEnabledVisibleButtons(visionOutput.actionButtons?.bet) +
      this.countEnabledVisibleButtons(visionOutput.actionButtons?.allIn) >
      0
    );
  }

  private isValidTurnState(
    turnState: VisionOutput["turnState"],
  ): turnState is NonNullable<VisionOutput["turnState"]> {
    return (
      turnState !== undefined &&
      Number.isFinite(turnState.confidence) &&
      turnState.confidence >= 0 &&
      turnState.confidence <= 1 &&
      typeof turnState.isHeroTurn === "boolean"
    );
  }

  private countEnabledVisibleButtons(
    button: VisionActionButton | undefined,
  ): number {
    if (!button) {
      return 0;
    }
    return button.isEnabled && button.isVisible ? 1 : 0;
  }

  private selectActionButton(
    visionOutput: VisionOutput,
    actionType: string,
  ): { state: "found"; button: VisionActionButton } | { state: "disabled"; button: VisionActionButton } | { state: "missing" } {
    const button = this.getActionButton(visionOutput, actionType);
    if (!button) {
      return { state: "missing" };
    }

    if (!this.isActionButtonActionable(button)) {
      return { state: "disabled", button };
    }

    return { state: "found", button };
  }

  private isActionButtonActionable(button: VisionActionButton): boolean {
    if (!button.isEnabled || !button.isVisible) {
      return false;
    }

    if (!Number.isFinite(button.confidence)) {
      return false;
    }

    return button.confidence >= MIN_ACTION_BUTTON_CONFIDENCE;
  }

  private getActionButton(
    visionOutput: VisionOutput,
    actionType: string,
  ): VisionActionButton | undefined {
    const actionButtons = visionOutput.actionButtons;
    if (!actionButtons) {
      return undefined;
    }

    switch (actionType) {
      case "fold":
        return actionButtons.fold;
      case "check":
        return actionButtons.check;
      case "call":
        return actionButtons.call;
      case "raise":
        return actionButtons.raise ?? actionButtons.bet;
      case "bet":
        return actionButtons.bet;
      case "allIn":
        return actionButtons.allIn;
      default:
        return undefined;
    }
  }

  private resolveScreenButton(
    visionButton: VisionActionButton,
    windowBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    },
  ): { x: number; y: number } {
    return this.windowManager.visionToScreenCoords(
      visionButton.screenCoords.x,
      visionButton.screenCoords.y,
      this.layoutResolution,
      windowBounds,
      this.dpiCalibration
    );
  }

  /**
   * Predicts expected state changes for verification
   */
  private predictStateChanges(decision: StrategyDecision): StateChange[] {
    const changes: StateChange[] = [];
    const { action } = decision;
    const { type, amount, position } = action;

    // Action taken change
    changes.push({
      type: 'action_taken',
      position
    });

    // Stack decrease for raise/call actions
    if (type === 'raise' && amount !== undefined) {
      changes.push({
        type: 'stack_decrease',
        amount,
        position
      });
    } else if (type === 'call') {
      // For call, we can't predict exact amount without game state
      // This would need to be enhanced with actual game state context
      changes.push({
        type: 'stack_decrease',
        position
      });
    }

    // Pot increase for raise/call actions
    if (type === 'raise' && amount !== undefined) {
      changes.push({
        type: 'pot_increase',
        amount
      });
    } else if (type === 'call') {
      changes.push({
        type: 'pot_increase'
      });
    }

    this.logger.debug('ResearchUIExecutor: Predicted state changes', { changes });
    return changes;
  }

  /**
   * Retries execution once on verification failure
   */
  private async retryExecution(decision: StrategyDecision, options: ExecutionOptions): Promise<ExecutionResult> {
    const retryOptions = {
      ...options,
      maxRetries: (options.maxRetries || 1) - 1,
      verifyAction: true
    };

    this.logger.info('ResearchUIExecutor: Retrying execution after verification failure');

    // Wait a brief moment before retry (100-300ms random jitter)
    const jitter = 100 + this.drawRandom(decision) * 200;
    await this.delay(jitter);

    // Create a new execution attempt
    const retryResult = await this.execute(decision, retryOptions);

    // Mark as retry attempt
    if (retryResult.verificationResult) {
      retryResult.verificationResult.retryCount = 1;
    }

    return retryResult;
  }

  /**
   * Creates failure result with timing
   */
  private createFailureResult(error: string, startTime: number): ExecutionResult {
    return {
      success: false,
      error,
      timing: {
        executionMs: Date.now() - startTime,
        totalMs: Date.now() - startTime
      },
      metadata: { executionMode: 'research-ui' }
    };
  }

  /**
   * Delay helper
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createCoordinateContext(windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): CoordinateContext {
    return {
      dpiCalibration: this.dpiCalibration,
      layoutResolution: this.layoutResolution,
      windowBounds
    };
  }

  private drawRandom(decision: StrategyDecision): number {
    const base = decision.metadata?.rngSeed ?? 0;
    const value = deterministicRandom(base, this.jitterCounter);
    this.jitterCounter += 1;
    return value;
  }
}
