import type { ActionExecutor, ExecutionResult, ExecutionOptions, SimulatorCommand, APIResponse, StateChange, VerificationResult } from '../types';
import type { StrategyDecision } from '@poker-bot/shared';
import type { ActionVerifier } from '../verifier';
import { deterministicRandom } from '../rng';

/**
 * Production-grade simulator executor that translates StrategyDecision actions
 * into simulator API calls with comprehensive error handling and verification.
 */
export class SimulatorExecutor implements ActionExecutor {
  private readonly apiEndpoint: string;
  private readonly verifier?: ActionVerifier;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  private jitterCounter = 0;

  constructor(
    apiEndpoint: string = 'http://localhost:8080/api',
    verifier?: ActionVerifier,
    logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
  ) {
    this.apiEndpoint = apiEndpoint;
    this.verifier = verifier;
    this.logger = logger;
  }

  async execute(decision: StrategyDecision, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs || 5000;

    try {
      this.logger.debug('SimulatorExecutor: Starting execution', {
        action: decision.action,
        timeoutMs
      });

      // Translate StrategyDecision.action to simulator API command
      const apiCommand = this.translateToSimulatorCommand(decision.action);
      this.logger.debug('SimulatorExecutor: Translated command', { apiCommand });

      // Execute via API call
      const response = await this.callSimulatorAPI(apiCommand, timeoutMs);
      this.logger.debug('SimulatorExecutor: API response', { response });

      const executionTime = Date.now() - startTime;

      // Optional verification
      let verificationResult: VerificationResult | undefined;
      if (options.verifyAction && this.verifier && response.success) {
        this.logger.debug('SimulatorExecutor: Starting verification');
        const expectedChanges = this.predictStateChanges(decision);

        const verifyStartTime = Date.now();
        verificationResult = await this.verifier.verifyAction(
          decision.action,
          expectedChanges,
          Math.max(1000, timeoutMs - executionTime) // Remaining time for verification
        );
        const verifyTime = Date.now() - verifyStartTime;

        this.logger.debug('SimulatorExecutor: Verification complete', {
          passed: verificationResult.passed,
          verifyTime
        });

        // Retry logic for verification failures
        if (!verificationResult.passed) {
          if ((options.maxRetries || 0) > 0) {
            this.logger.warn('SimulatorExecutor: Verification failed, retrying', {
              retryCount: 1,
              reason: verificationResult.mismatchReason
            });

            // Re-execute once on mismatch
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
                executionMode: 'simulator',
                platform: 'simulator'
              }
            };
          }
        }
      }

      const totalTime = Date.now() - startTime;

      return {
        success: response.success,
        actionExecuted: decision.action,
        verificationResult,
        timing: {
          executionMs: executionTime,
          verificationMs: verificationResult ? totalTime - executionTime : undefined,
          totalMs: totalTime
        },
        metadata: {
          executionMode: 'simulator',
          platform: 'simulator'
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';
      this.logger.error('SimulatorExecutor: Execution failed', { error: errorMessage });

      return {
        success: false,
        error: errorMessage,
        timing: {
          executionMs: Date.now() - startTime,
          totalMs: Date.now() - startTime
        },
        metadata: { executionMode: 'simulator' }
      };
    }
  }

  /**
   * Translates an Action into a simulator-specific command format
   */
  private translateToSimulatorCommand(action: StrategyDecision['action']): SimulatorCommand {
    const { type, amount, position } = action;

    // Validate action type
    if (!['fold', 'check', 'call', 'raise'].includes(type)) {
      throw new Error(`Unsupported action type: ${type}`);
    }

    // Build command based on action type
    const command: SimulatorCommand = {
      action: type,
      position: position,
    };

    // Add amount for raise actions
    if (type === 'raise') {
      if (amount === undefined || !Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Raise action requires positive amount, got: ${amount}`);
      }
      command.amount = amount;
    }

    this.logger.debug('Translated action to simulator command', {
      original: action,
      translated: command
    });

    return command;
  }

  /**
   * Makes HTTP API call to simulator with timeout and error handling
   */
  private async callSimulatorAPI(command: SimulatorCommand, timeoutMs: number): Promise<APIResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      this.logger.debug('Making simulator API call', {
        endpoint: this.apiEndpoint,
        command,
        timeoutMs
      });

      const response = await fetch(`${this.apiEndpoint}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(command),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const apiResponse = await response.json() as APIResponse;

      if (!apiResponse.success && apiResponse.error) {
        this.logger.warn('Simulator API returned error', { error: apiResponse.error });
      }

      return apiResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Simulator API timeout after ${timeoutMs}ms`);
        }
        throw new Error(`Simulator API call failed: ${error.message}`);
      }
      throw new Error('Simulator API call failed with unknown error');
    }
  }

  /**
   * Predicts expected state changes from a decision for verification
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

    this.logger.debug('Predicted state changes for verification', { changes });
    return changes;
  }

  /**
   * Retries execution once on verification failure
   */
  private async retryExecution(decision: StrategyDecision, options: ExecutionOptions): Promise<ExecutionResult> {
    const retryOptions = {
      ...options,
      maxRetries: (options.maxRetries || 1) - 1,
      verifyAction: true // Force verification on retry
    };

    this.logger.info('Retrying execution after verification failure');

    // Wait a brief moment before retry (100-300ms random jitter)
    const jitter = 100 + this.drawRandom(decision) * 200;
    await new Promise(resolve => setTimeout(resolve, jitter));

    // Create a new execution attempt
    const retryResult = await this.execute(decision, retryOptions);

    // Mark as retry attempt
    if (retryResult.verificationResult) {
      retryResult.verificationResult.retryCount = 1;
    }

    return retryResult;
  }

  private drawRandom(decision: StrategyDecision): number {
    const base = decision.metadata?.rngSeed ?? 0;
    const value = deterministicRandom(base, this.jitterCounter);
    this.jitterCounter += 1;
    return value;
  }
}
