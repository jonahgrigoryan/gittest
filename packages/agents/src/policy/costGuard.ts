import type { AggregatedCostSummary, CostBudgetPolicy } from "../types";

export interface CostGuardEvaluation {
  allowed: boolean;
  reason?: "tokens_decision" | "tokens_day" | "latency";
}

export interface CostGuardState {
  tokensToday: number;
  lastReset: number;
  consecutiveFailures: number;
}

export class CostGuard {
  private readonly policy: CostBudgetPolicy;
  private state: CostGuardState;

  constructor(policy: CostBudgetPolicy) {
    this.policy = policy;
    this.state = {
      tokensToday: 0,
      lastReset: Date.now(),
      consecutiveFailures: 0
    };
  }

  evaluate(summary: AggregatedCostSummary, latencyMs: number): CostGuardEvaluation {
    this.resetIfNeeded();

    if (summary.totalTokens > this.policy.maxTokensDecision) {
      return { allowed: false, reason: "tokens_decision" };
    }

    if (this.state.tokensToday + summary.totalTokens > this.policy.maxTokensDay) {
      return { allowed: false, reason: "tokens_day" };
    }

    if (latencyMs > this.policy.maxLatencyMs) {
      return { allowed: false, reason: "latency" };
    }

    return { allowed: true };
  }

  recordDecision(summary: AggregatedCostSummary): void {
    this.resetIfNeeded();
    this.state.tokensToday += summary.totalTokens;
  }

  recordFailure(): void {
    this.state.consecutiveFailures += 1;
  }

  recordSuccess(): void {
    this.state.consecutiveFailures = Math.max(0, this.state.consecutiveFailures - 1);
  }

  getConsecutiveFailures(): number {
    return this.state.consecutiveFailures;
  }

  getState(): CostGuardState {
    this.resetIfNeeded();
    return { ...this.state };
  }

  private resetIfNeeded(): void {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (now - this.state.lastReset >= oneDayMs) {
      this.state.tokensToday = 0;
      this.state.lastReset = now;
    }
  }
}
