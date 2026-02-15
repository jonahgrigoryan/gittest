import type { Action } from "@poker-bot/shared";
import type { StrategyDecision } from "@poker-bot/shared";

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

export interface StateChange {
  type: "pot_increase" | "stack_decrease" | "action_taken";
  amount?: number;
  position?: string;
}

export interface VerificationSnapshot {
  pot?: number;
  stacks?: Record<string, number>;
  actionHistory?: Action[];
  changes?: StateChange[];
}

export interface VerificationResult {
  passed: boolean;
  expectedState?: VerificationSnapshot;
  actualState?: VerificationSnapshot;
  mismatchReason?: string;
  retryCount: number;
}

export type ExecutionMode = "simulator" | "api" | "research-ui";

export interface ActionExecutor {
  execute(
    decision: StrategyDecision,
    options?: ExecutionOptions,
  ): Promise<ExecutionResult>;
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
  researchUI?: ResearchUIConfig;
}

export interface InputField {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Configuration for bet input field with decimal formatting options
 */
export interface BetInputConfig extends InputField {
  decimalPrecision: number;
  decimalSeparator: "," | ".";
}

/**
 * Extended ResearchUI configuration with bet input handling
 */
export interface ResearchUIConfig extends ComplianceConfig {
  windowTitlePatterns?: string[];
  processNames?: string[];
  minWindowSize?: { width: number; height: number };
  betInputField?: BetInputConfig;
  minRaiseAmount?: number;
}
