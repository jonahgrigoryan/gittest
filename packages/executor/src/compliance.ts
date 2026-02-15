import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StrategyDecision } from "@poker-bot/shared";
import type { ComplianceConfig, ComplianceResult } from "./types";

const execFileAsync = promisify(execFile);
const REQUIRED_BUILD_FLAG = "RESEARCH_UI_ENABLED";

export interface ProcessWindowContext {
  processName: string;
  title: string;
}

export interface ProcessSnapshot {
  runningProcesses: string[];
  frontmostProcess?: string;
  windows: ProcessWindowContext[];
}

export interface ProcessListProvider {
  getSnapshot(): Promise<ProcessSnapshot>;
}

interface ComplianceCheckerConfig extends ComplianceConfig {
  processNames?: string[];
}

interface RunningProcessCheckResult {
  violations: string[];
  matchedProcessName?: string;
}

const PROCESS_LINE_PREFIX = "PROC||";
const FRONTMOST_LINE_PREFIX = "FRONT||";
const WINDOW_LINE_PREFIX = "WIN||";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

/**
 * Production process list provider for macOS.
 * Prefers AppleScript process/window enumeration and safely falls back to ps.
 */
export class MacOSProcessListProvider implements ProcessListProvider {
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console) {
    this.logger = logger;
  }

  async getSnapshot(): Promise<ProcessSnapshot> {
    if (process.platform === "darwin") {
      try {
        return await this.getSnapshotFromAppleScript();
      } catch (error) {
        this.logger.warn("ComplianceChecker: AppleScript process enumeration failed, falling back to ps", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return this.getSnapshotFromPs();
  }

  private async getSnapshotFromAppleScript(): Promise<ProcessSnapshot> {
    const script = `
set output to ""
tell application "System Events"
  repeat with proc in application processes
    set procName to name of proc
    set output to output & "${PROCESS_LINE_PREFIX}" & procName & linefeed

    if frontmost of proc is true then
      set output to output & "${FRONTMOST_LINE_PREFIX}" & procName & linefeed
    end if

    try
      repeat with win in windows of proc
        set winTitle to name of win
        set output to output & "${WINDOW_LINE_PREFIX}" & procName & "||" & winTitle & linefeed
      end repeat
    end try
  end repeat
end tell
return output
`;

    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    return this.parseSnapshotFromAppleScript(stdout);
  }

  private parseSnapshotFromAppleScript(rawOutput: string): ProcessSnapshot {
    const runningProcesses: string[] = [];
    const windows: ProcessWindowContext[] = [];
    let frontmostProcess: string | undefined;

    const lines = rawOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const line of lines) {
      if (line.startsWith(PROCESS_LINE_PREFIX)) {
        runningProcesses.push(line.slice(PROCESS_LINE_PREFIX.length).trim());
        continue;
      }

      if (line.startsWith(FRONTMOST_LINE_PREFIX)) {
        frontmostProcess = line.slice(FRONTMOST_LINE_PREFIX.length).trim();
        continue;
      }

      if (line.startsWith(WINDOW_LINE_PREFIX)) {
        const payload = line.slice(WINDOW_LINE_PREFIX.length);
        const [processName, ...titleParts] = payload.split("||");
        const title = titleParts.join("||").trim();
        const cleanProcessName = processName?.trim();
        if (cleanProcessName && title.length > 0) {
          windows.push({ processName: cleanProcessName, title });
        }
      }
    }

    const dedupedProcesses = uniqueStrings(runningProcesses);
    if (frontmostProcess && !dedupedProcesses.includes(frontmostProcess)) {
      dedupedProcesses.push(frontmostProcess);
    }

    return {
      runningProcesses: dedupedProcesses,
      frontmostProcess,
      windows
    };
  }

  private async getSnapshotFromPs(): Promise<ProcessSnapshot> {
    const { stdout } = await execFileAsync("ps", ["-A", "-o", "comm="]);
    const runningProcesses = uniqueStrings(
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const commandName = line.split(" ")[0]?.trim() ?? line;
          const pathSegments = commandName.split("/").filter((segment) => segment.length > 0);
          return pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : commandName;
        })
    );

    return {
      runningProcesses,
      windows: []
    };
  }
}

/**
 * Production-grade compliance checker for research UI mode.
 * Validates environment against allowlists and enforces build flags.
 */
export class ComplianceChecker {
  private readonly config: ComplianceCheckerConfig;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;
  private readonly processListProvider: ProcessListProvider;

  constructor(
    config: ComplianceCheckerConfig,
    logger: Pick<Console, "debug" | "info" | "warn" | "error"> = console,
    processListProvider: ProcessListProvider = new MacOSProcessListProvider(logger)
  ) {
    this.config = {
      ...config,
      allowlist: uniqueStrings(config.allowlist),
      prohibitedSites: uniqueStrings(config.prohibitedSites),
      processNames: uniqueStrings(config.processNames ?? [])
    };
    this.logger = logger;
    this.processListProvider = processListProvider;
  }

  /**
   * Validates environment against allowlist
   */
  async checkEnvironment(): Promise<ComplianceResult> {
    this.logger.debug("ComplianceChecker: Checking environment", {
      allowlist: this.config.allowlist,
      prohibitedSites: this.config.prohibitedSites,
      processNames: this.config.processNames,
      requireBuildFlag: this.config.requireBuildFlag
    });

    const violations: string[] = [];

    try {
      const processSnapshot = await this.processListProvider.getSnapshot();

      if (!this.isResearchUIModeAllowed()) {
        violations.push(this.getBuildFlagViolation());
      }

      const processResult = await this.checkRunningProcesses(processSnapshot);
      violations.push(...processResult.violations);

      const allowlistViolations = this.checkActiveContextAgainstAllowlist(
        processSnapshot,
        processResult.matchedProcessName
      );
      violations.push(...allowlistViolations);

      const prohibitedViolations = await this.checkProhibitedSites(processSnapshot);
      violations.push(...prohibitedViolations);

      const result: ComplianceResult = {
        allowed: violations.length === 0,
        reason: violations[0],
        violations
      };

      this.logger.debug("ComplianceChecker: Environment check complete", result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("ComplianceChecker: Environment check failed", { error: errorMessage });

      return {
        allowed: false,
        reason: `Environment check error: ${errorMessage}`,
        violations: [`Environment check error: ${errorMessage}`]
      };
    }
  }

  /**
   * Gates research UI behind build flag
   */
  isResearchUIModeAllowed(): boolean {
    if (!this.config.requireBuildFlag) {
      return true;
    }

    return process.env[REQUIRED_BUILD_FLAG] === "true";
  }

  /**
   * Checks running processes against required process selectors.
   * Requirement 2.6/2.7: required poker process must be running.
   */
  private async checkRunningProcesses(snapshot: ProcessSnapshot): Promise<RunningProcessCheckResult> {
    const requiredProcessSelectors =
      this.config.processNames && this.config.processNames.length > 0
        ? this.config.processNames
        : this.config.allowlist;

    if (requiredProcessSelectors.length === 0) {
      return {
        violations: [
          "No required process selectors configured for compliance check (processNames or allowlist)."
        ]
      };
    }

    const matchedProcess = snapshot.runningProcesses.find((processName) =>
      requiredProcessSelectors.some((pattern) => this.matchesPattern(processName, pattern))
    );

    if (!matchedProcess) {
      return {
        violations: [
          `Required process not running (expected one of: ${requiredProcessSelectors.join(", ")})`
        ]
      };
    }

    return {
      violations: [],
      matchedProcessName: matchedProcess
    };
  }

  /**
   * Requirement 2.8: active process context must be in allowlist.
   */
  private checkActiveContextAgainstAllowlist(
    snapshot: ProcessSnapshot,
    matchedProcessName?: string
  ): string[] {
    if (this.config.allowlist.length === 0) {
      return [];
    }

    const violations: string[] = [];

    if (matchedProcessName && !this.isAllowlisted(matchedProcessName)) {
      violations.push(`Required process not in allowlist: ${matchedProcessName}`);
    }

    if (snapshot.frontmostProcess && !this.isAllowlisted(snapshot.frontmostProcess)) {
      violations.push(`Active process context violates allowlist: ${snapshot.frontmostProcess}`);
    }

    return violations;
  }

  /**
   * Checks for prohibited indicators in process names and window titles.
   * Requirement 2.9: prohibited indicators must block execution.
   */
  private async checkProhibitedSites(snapshot: ProcessSnapshot): Promise<string[]> {
    const prohibitedIndicators = this.config.prohibitedSites;
    if (prohibitedIndicators.length === 0) {
      return [];
    }

    const violations = new Set<string>();

    for (const processName of snapshot.runningProcesses) {
      for (const indicator of prohibitedIndicators) {
        if (this.matchesPattern(processName, indicator)) {
          violations.add(`Prohibited process indicator detected in running process: ${processName}`);
        }
      }
    }

    if (snapshot.frontmostProcess) {
      for (const indicator of prohibitedIndicators) {
        if (this.matchesPattern(snapshot.frontmostProcess, indicator)) {
          violations.add(
            `Prohibited process indicator detected in active context: ${snapshot.frontmostProcess}`
          );
        }
      }
    }

    for (const windowEntry of snapshot.windows) {
      for (const indicator of prohibitedIndicators) {
        if (this.matchesPattern(windowEntry.title, indicator)) {
          violations.add(
            `Prohibited site indicator detected in window title: ${windowEntry.processName} -> ${windowEntry.title}`
          );
        }
      }
    }

    return [...violations];
  }

  /**
   * Runtime compliance validation before executing actions
   */
  async validateExecution(decision: StrategyDecision): Promise<boolean> {
    this.logger.debug("ComplianceChecker: Validating execution", {
      position: decision.action.position,
      action: decision.action.type
    });

    try {
      const envCheck = await this.checkEnvironment();
      if (!envCheck.allowed) {
        this.logger.error("ComplianceChecker: Execution blocked by environment check", {
          violations: envCheck.violations,
          reason: envCheck.reason
        });
        return false;
      }

      this.logger.info("ComplianceChecker: Execution validated");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("ComplianceChecker: Execution validation failed", { error: errorMessage });
      return false;
    }
  }

  /**
   * Validates a specific site against allowlist
   */
  validateSite(site: string): boolean {
    if (this.config.allowlist.length === 0) {
      this.logger.debug("ComplianceChecker: Site validation blocked because allowlist is empty", {
        site
      });
      return false;
    }

    const isAllowed = this.isAllowlisted(site);
    this.logger.debug("ComplianceChecker: Site validation", {
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
    return this.config.prohibitedSites.some((prohibited) => this.matchesPattern(processName, prohibited));
  }

  /**
   * Gets compliance status summary
   */
  getStatus(): { allowed: boolean; violations: string[] } {
    const buildFlagViolation = this.isResearchUIModeAllowed() ? [] : [this.getBuildFlagViolation()];

    return {
      allowed: buildFlagViolation.length === 0,
      violations: buildFlagViolation
    };
  }

  private isAllowlisted(value: string): boolean {
    if (this.config.allowlist.length === 0) {
      return true;
    }

    return this.config.allowlist.some((allowedPattern) => this.matchesPattern(value, allowedPattern));
  }

  private matchesPattern(value: string, pattern: string): boolean {
    if (value.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }

    try {
      return new RegExp(pattern, "i").test(value);
    } catch {
      return false;
    }
  }

  private getBuildFlagViolation(): string {
    const actualValue = process.env[REQUIRED_BUILD_FLAG] ?? "<unset>";
    return `Required build flag ${REQUIRED_BUILD_FLAG}=true is missing (current: ${actualValue})`;
  }
}
