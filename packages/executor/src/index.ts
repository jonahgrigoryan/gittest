import { SimulatorExecutor } from './simulators/simulator';
import { ResearchUIExecutor } from './research_bridge';
import { WindowManager } from './window_manager';
import { ComplianceChecker } from './compliance';
import { ActionVerifier } from './verifier';
import type {
  ActionExecutor,
  ExecutionMode,
  ExecutorConfig,
  WindowConfig,
  ResearchUIConfig
} from './types';

/**
 * Validates ResearchUI configuration for required fields
 * Throws descriptive errors for missing/invalid fields
 */
function validateResearchUIConfig(config: ResearchUIConfig): void {
  const errors: string[] = [];

  // Validate betInputField (required for research-ui mode)
  if (config.betInputField === undefined) {
    errors.push('betInputField is required for research-ui mode');
  } else {
    const field = config.betInputField;
    
    if (typeof field.x !== 'number') {
      errors.push('betInputField.x must be a number');
    }
    if (typeof field.y !== 'number') {
      errors.push('betInputField.y must be a number');
    }
    if (typeof field.width !== 'number' || field.width <= 0) {
      errors.push('betInputField.width must be a positive number');
    }
    if (typeof field.height !== 'number' || field.height <= 0) {
      errors.push('betInputField.height must be a positive number');
    }
    if (typeof field.decimalPrecision !== 'number' || field.decimalPrecision < 0 || field.decimalPrecision > 10) {
      errors.push('betInputField.decimalPrecision must be a number between 0 and 10');
    }
    if (field.decimalSeparator !== ',' && field.decimalSeparator !== '.') {
      errors.push('betInputField.decimalSeparator must be "," or "."');
    }
  }

  // Validate minRaiseAmount (required for research-ui mode)
  if (config.minRaiseAmount === undefined) {
    errors.push('minRaiseAmount is required for research-ui mode');
  } else {
    if (typeof config.minRaiseAmount !== 'number' || config.minRaiseAmount < 0) {
      errors.push('minRaiseAmount must be a non-negative number');
    }
  }

  if (errors.length > 0) {
    throw new Error(`ResearchUI config validation failed: ${errors.join('; ')}`);
  }
}

/**
 * Factory function to create appropriate ActionExecutor based on mode
 */
export function createActionExecutor(
  mode: ExecutionMode,
  config?: ExecutorConfig,
  verifier?: ActionVerifier,
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
): ActionExecutor {
  logger.debug('Creating ActionExecutor', { mode, config });

  switch (mode) {
    case 'simulator':
      if (!config?.simulatorEndpoint) {
        logger.warn('No simulator endpoint provided, using default');
      }
      return new SimulatorExecutor(
        config?.simulatorEndpoint || 'http://localhost:8080/api',
        verifier,
        logger
      );

    case 'research-ui':
      if (!config?.researchUI) {
        throw new Error('Research UI config required for research-ui mode');
      }

      // Validate required fields for research-ui mode
      validateResearchUIConfig(config.researchUI);

      // Create window manager
      const windowConfig: WindowConfig = {
        titlePatterns: config.researchUI.allowlist || [],
        processNames: [], // Could be derived from allowlist
        minWindowSize: { width: 800, height: 600 }
      };
      const windowManager = new WindowManager(windowConfig, logger);

      // Create compliance checker
      const complianceConfig: ResearchUIConfig = {
        allowlist: config.researchUI.allowlist || [],
        prohibitedSites: config.researchUI.prohibitedSites || [],
        requireBuildFlag: config.researchUI.requireBuildFlag ?? true,
        betInputField: config.researchUI.betInputField,
        minRaiseAmount: config.researchUI.minRaiseAmount
      };
      const complianceChecker = new ComplianceChecker(complianceConfig, logger);

      return new ResearchUIExecutor(
        windowManager,
        complianceChecker,
        verifier,
        config.researchUI,
        logger
      );

    case 'api':
      // Future: implement direct API executor
      throw new Error('API executor not yet implemented');

    default:
      throw new Error(`Unknown execution mode: ${mode}`);
  }
}

// Export all types and classes
export * from './types';
export { SimulatorExecutor } from './simulators/simulator';
export { ResearchUIExecutor } from './research_bridge';
export { WindowManager } from './window_manager';
export { ComplianceChecker } from './compliance';
export { ActionVerifier } from './verifier';
export type { VisionClientInterface } from './verifier';
export { BetInputHandler } from './bet_input_handler';
