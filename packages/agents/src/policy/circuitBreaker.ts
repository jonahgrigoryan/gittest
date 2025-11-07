import type { AgentFailureReason, CircuitBreakerConfig, CircuitBreakerState } from "../types";

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    this.state = {
      consecutiveFailures: 0
    };
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  registerFailure(reason: AgentFailureReason, timestamp: number): CircuitBreakerState {
    this.state.consecutiveFailures += 1;
    this.state.lastFailureReason = reason;

    if (this.state.consecutiveFailures >= this.config.consecutiveFailureThreshold) {
      this.state.trippedAt = this.state.trippedAt ?? timestamp;
      this.state.cooldownHandsRemaining = this.config.cooldownHands;
    }

    return this.getState();
  }

  registerSuccess(): void {
    this.state.consecutiveFailures = 0;
    this.state.lastFailureReason = undefined;
    if (this.state.cooldownHandsRemaining !== undefined && this.state.cooldownHandsRemaining <= 0) {
      this.state.trippedAt = undefined;
      this.state.cooldownHandsRemaining = undefined;
    }
  }

  stepCooldown(): void {
    if (this.state.cooldownHandsRemaining !== undefined && this.state.cooldownHandsRemaining > 0) {
      this.state.cooldownHandsRemaining -= 1;
    }
  }

  isCoolingDown(now: number): boolean {
    if (!this.state.trippedAt) {
      return false;
    }

    const remainingHands = this.state.cooldownHandsRemaining ?? 0;
    const minCooldownSatisfied =
      !this.config.minCooldownMs || now - this.state.trippedAt >= this.config.minCooldownMs;

    if (remainingHands <= 0 && minCooldownSatisfied) {
      this.state.trippedAt = undefined;
      this.state.cooldownHandsRemaining = undefined;
      return false;
    }

    return true;
  }

  reset(): void {
    this.state = {
      consecutiveFailures: 0
    };
  }
}
