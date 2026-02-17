import { WindowManager } from './window_manager';
import { ComplianceChecker } from './compliance';
import { BetInputHandler } from './bet_input_handler';
import type { ActionExecutor, ExecutionResult, ExecutionOptions, ResearchUIConfig } from './types';
import type { StrategyDecision } from '@poker-bot/shared';
import type { ActionVerifier } from './verifier';
import { deterministicRandom } from './rng';
import { InputAutomation, type CoordinateContext } from './input_automation';

// Local interfaces to avoid import issues
interface ButtonInfo {
  screenCoords: { x: number; y: number };
  isEnabled: boolean;
  isVisible: boolean;
  confidence: number;
  text?: string;
}

interface WindowHandle {
  id: string | number;
  title: string;
  processName: string;
}

interface VisionOutput {
  turnState?: {
    isHeroTurn: boolean;
    actionTimer?: number;
    confidence: number;
  };
}

interface StateChange {
  type: 'pot_increase' | 'stack_decrease' | 'action_taken';
  amount?: number;
  position?: string;
}

const DEFAULT_LAYOUT_RESOLUTION = { width: 1920, height: 1080 } as const;

interface ResearchUIExecutorDependencies {
  inputAutomation?: InputAutomation;
  betInputHandler?: BetInputHandler;
  layoutResolution?: { width: number; height: number };
  dpiCalibration?: number;
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

      this.inputAutomation.updateCoordinateContext(this.createCoordinateContext(windowBounds));
      this.inputAutomation.updateRandomSeed(decision.metadata?.rngSeed ?? 0);

      // 4. Check turn state
      const turnState = await this.getCurrentTurnState();
      if (!turnState?.isHeroTurn) {
        const error = 'Not hero\'s turn';
        this.logger.warn('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      this.logger.debug('ResearchUIExecutor: Turn state validated', { turnState });

      // 5. Find and validate action button
      const actionButton = await this.findActionButton(decision.action.type);
      if (!actionButton) {
        const error = `Action button ${decision.action.type} not found or not actionable`;
        this.logger.error('ResearchUIExecutor: ' + error);
        return this.createFailureResult(error, startTime);
      }

      this.logger.debug('ResearchUIExecutor: Action button found', {
        actionType: decision.action.type,
        button: actionButton
      });

      // 6. Execute action via OS automation
      const executionTime = Date.now() - startTime;
      const actionResult = await this.performAction(decision, actionButton, windowHandle, windowBounds);

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
    buttonInfo: ButtonInfo,
    windowHandle: WindowHandle,
    windowBounds: { x: number; y: number; width: number; height: number }
  ): Promise<ExecutionResult> {
    const action = decision.action;
    this.logger.debug('ResearchUIExecutor: Performing action', {
      action,
      buttonInfo,
      windowHandle
    });

    try {
      this.inputAutomation.updateCoordinateContext(this.createCoordinateContext(windowBounds));

      // For raise actions: input amount first, then click the raise button.
      if (action.type === 'raise' && action.amount !== undefined) {
        this.logger.debug('ResearchUIExecutor: Handling bet sizing');
        await this.betInputHandler.inputBetAmount(action, windowHandle, decision.metadata?.rngSeed);
      }

      await this.inputAutomation.clickAt(buttonInfo.screenCoords.x, buttonInfo.screenCoords.y);
      this.logger.info('ResearchUIExecutor: Clicked action button', {
        action: action.type,
        coordinates: buttonInfo.screenCoords
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
   * Gets current turn state from vision system
   */
  private async getCurrentTurnState(): Promise<VisionOutput['turnState']> {
    // In production, this would get turn state from actual vision system
    // For now, return mock data that would be replaced by real implementation

    return {
      isHeroTurn: true,
      actionTimer: 30,
      confidence: 0.99
    };
  }

  /**
   * Finds action button from vision output
   */
  private async findActionButton(actionType: string): Promise<ButtonInfo | null> {
    // In production, this would:
    // 1. Capture current vision output
    // 2. Use WindowManager.findActionButton()
    // 3. Return the button info

    // Mock implementation - would be replaced by actual vision integration
    const mockButton: ButtonInfo = {
      screenCoords: { x: 500, y: 600 },
      isEnabled: true,
      isVisible: true,
      confidence: 0.95,
      text: actionType
    };

    return mockButton;
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
