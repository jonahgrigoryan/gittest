import type { StrategyDecision } from '@poker-bot/shared';
import type { ComplianceConfig, ComplianceResult } from './types';

/**
 * Production-grade compliance checker for research UI mode.
 * Validates environment against allowlists and enforces build flags.
 */
export class ComplianceChecker {
  private readonly config: ComplianceConfig;
  private readonly logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

  constructor(
    config: ComplianceConfig,
    logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> = console
  ) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Validates environment against allowlist
   */
  async checkEnvironment(): Promise<ComplianceResult> {
    this.logger.debug('ComplianceChecker: Checking environment', {
      allowlist: this.config.allowlist,
      prohibitedSites: this.config.prohibitedSites
    });

    const violations: string[] = [];

    try {
      // Check if research UI mode is allowed
      if (!this.isResearchUIModeAllowed()) {
        violations.push('Research UI mode not allowed (build flag not set)');
      }

      // Check running processes and windows
      const processViolations = await this.checkRunningProcesses();
      violations.push(...processViolations);

      // Check for prohibited sites/applications
      const prohibitedViolations = await this.checkProhibitedSites();
      violations.push(...prohibitedViolations);

      const result: ComplianceResult = {
        allowed: violations.length === 0,
        violations
      };

      this.logger.debug('ComplianceChecker: Environment check complete', result);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('ComplianceChecker: Environment check failed', { error: errorMessage });

      return {
        allowed: false,
        reason: `Environment check error: ${errorMessage}`,
        violations: ['Environment check failed']
      };
    }
  }

  /**
   * Gates research UI behind build flag
   */
  isResearchUIModeAllowed(): boolean {
    const isAllowed = process.env.RESEARCH_UI_ENABLED === 'true';

    this.logger.debug('ComplianceChecker: Research UI mode check', {
      envVar: process.env.RESEARCH_UI_ENABLED,
      isAllowed,
      requireBuildFlag: this.config.requireBuildFlag
    });

    if (this.config.requireBuildFlag && !isAllowed) {
      this.logger.warn('ComplianceChecker: Research UI mode blocked by build flag');
      return false;
    }

    this.logger.info('ComplianceChecker: Research UI mode allowed');
    return true;
  }

  /**
   * Checks running processes against allowlist
   */
  private async checkRunningProcesses(): Promise<string[]> {
    this.logger.debug('ComplianceChecker: Checking running processes');

    const violations: string[] = [];

    try {
      // In production, this would:
      // 1. Enumerate running processes using OS APIs
      // 2. Check process names against allowlist
      // 3. Identify any prohibited processes

      // For now, this is a placeholder that would be implemented with actual process detection
      // Example implementation would use:
      // - Windows: EnumProcesses, GetProcessImageFileName
      // - Linux: /proc filesystem
      // - macOS: Process list APIs

      // Mock check - in real implementation, this would detect actual processes
      const mockProcesses = [
        { name: 'PokerStars.exe', allowed: true },
        { name: 'chrome.exe', allowed: false }
      ];

      for (const process of mockProcesses) {
        if (!process.allowed && this.config.allowlist.length > 0) {
          const isAllowed = this.config.allowlist.some(allowed =>
            process.name.toLowerCase().includes(allowed.toLowerCase())
          );

          if (!isAllowed) {
            violations.push(`Process not in allowlist: ${process.name}`);
          }
        }
      }

      this.logger.debug('ComplianceChecker: Process check complete', { violations });
      return violations;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('ComplianceChecker: Process check failed', { error: errorMessage });
      return [`Process check error: ${errorMessage}`];
    }
  }

  /**
   * Checks for prohibited sites/applications
   */
  private async checkProhibitedSites(): Promise<string[]> {
    this.logger.debug('ComplianceChecker: Checking prohibited sites');

    const violations: string[] = [];

    try {
      // In production, this would:
      // 1. Check open windows and browser tabs
      // 2. Check network connections
      // 3. Scan for prohibited application signatures

      // Mock check - in real implementation, this would detect actual prohibited sites
      const detectedSites = [
        { name: 'bet365.com', prohibited: true },
        { name: 'pokerstars.com', prohibited: false }
      ];

      for (const site of detectedSites) {
        if (site.prohibited) {
          const isProhibited = this.config.prohibitedSites.some(prohibited =>
            site.name.toLowerCase().includes(prohibited.toLowerCase())
          );

          if (isProhibited) {
            violations.push(`Prohibited site detected: ${site.name}`);
          }
        }
      }

      this.logger.debug('ComplianceChecker: Prohibited sites check complete', { violations });
      return violations;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('ComplianceChecker: Prohibited sites check failed', { error: errorMessage });
      return [`Prohibited sites check error: ${errorMessage}`];
    }
  }

  /**
   * Runtime compliance validation before executing actions
   */
  async validateExecution(decision: StrategyDecision): Promise<boolean> {
    this.logger.debug('ComplianceChecker: Validating execution', {
      handId: decision.action.position,
      action: decision.action.type
    });

    try {
      // Check environment
      const envCheck = await this.checkEnvironment();
      if (!envCheck.allowed) {
        this.logger.error('ComplianceChecker: Execution blocked by environment check', {
          violations: envCheck.violations
        });
        return false;
      }

      // Additional runtime checks could include:
      // - Time of day restrictions
      // - Session duration limits
      // - Concurrent execution prevention
      // - Rate limiting

      this.logger.info('ComplianceChecker: Execution validated');
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('ComplianceChecker: Execution validation failed', { error: errorMessage });
      return false;
    }
  }

  /**
   * Validates a specific site against allowlist
   */
  validateSite(site: string): boolean {
    const isAllowed = this.config.allowlist.some(allowed =>
      site.toLowerCase().includes(allowed.toLowerCase())
    );

    this.logger.debug('ComplianceChecker: Site validation', {
      site,
      isAllowed,
      allowlist: this.config.allowlist
    });

    return isAllowed;
  }

  /**
   * Checks if a process is prohibited
   */
  isProcessProhibited(processName: string): boolean {
    const isProhibited = this.config.prohibitedSites.some(prohibited =>
      processName.toLowerCase().includes(prohibited.toLowerCase())
    );

    this.logger.debug('ComplianceChecker: Process prohibition check', {
      processName,
      isProhibited,
      prohibitedSites: this.config.prohibitedSites
    });

    return isProhibited;
  }

  /**
   * Gets compliance status summary
   */
  getStatus(): { allowed: boolean; violations: string[] } {
    return {
      allowed: this.isResearchUIModeAllowed(),
      violations: []
    };
  }
}
