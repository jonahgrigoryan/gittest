import { SimulatorExecutor } from './simulators/simulator';
import { ResearchUIExecutor } from './research_bridge';
import { WindowManager } from './window_manager';
import { ComplianceChecker } from './compliance';
import { BetInputHandler } from './bet_input_handler';
import { ActionVerifier } from './verifier';
import type {
  ActionExecutor,
  ExecutionMode,
  ExecutorConfig,
  WindowConfig,
  ComplianceConfig
} from './types';

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

      // Create window manager
      const windowConfig: WindowConfig = {
        titlePatterns: config.researchUI.allowlist || [],
        processNames: [], // Could be derived from allowlist
        minWindowSize: { width: 800, height: 600 }
      };
      const windowManager = new WindowManager(windowConfig, logger);

      // Create compliance checker
      const complianceConfig: ComplianceConfig = {
        allowlist: config.researchUI.allowlist || [],
        prohibitedSites: config.researchUI.prohibitedSites || [],
        requireBuildFlag: config.researchUI.requireBuildFlag ?? true
      };
      const complianceChecker = new ComplianceChecker(complianceConfig, logger);

      return new ResearchUIExecutor(
        windowManager,
        complianceChecker,
        verifier,
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
export { BetInputHandler } from './bet_input_handler';
export { ActionVerifier } from './verifier';
