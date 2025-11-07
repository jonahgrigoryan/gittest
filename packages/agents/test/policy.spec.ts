import { describe, it, expect } from "vitest";
import { CostGuard } from "../src/policy/costGuard";
import { CircuitBreaker } from "../src/policy/circuitBreaker";

describe("CostGuard", () => {
  const policy = {
    maxTokensDecision: 50,
    maxTokensDay: 200,
    maxLatencyMs: 500,
    consecutiveFailureThreshold: 2,
    recoveryHands: 1
  } as const;

  it("rejects decisions that exceed per-decision token cap", () => {
    const guard = new CostGuard(policy);
    const result = guard.evaluate({ totalTokens: 60, promptTokens: 40, completionTokens: 20 }, 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tokens_decision");
  });

  it("tracks consecutive failures", () => {
    const guard = new CostGuard(policy);
    guard.recordFailure();
    guard.recordFailure();
    expect(guard.getConsecutiveFailures()).toBe(2);
    guard.recordSuccess();
    expect(guard.getConsecutiveFailures()).toBe(1);
  });
});

describe("CircuitBreaker", () => {
  const config = {
    consecutiveFailureThreshold: 2,
    cooldownHands: 1,
    minCooldownMs: 0
  } as const;

  it("triggers after consecutive failures", () => {
    const breaker = new CircuitBreaker(config);
    const now = Date.now();
    breaker.registerFailure("validation", now);
    expect(breaker.getState().consecutiveFailures).toBe(1);
    breaker.registerFailure("validation", now + 10);
    expect(breaker.getState().cooldownHandsRemaining).toBe(1);
    expect(breaker.isCoolingDown(now + 20)).toBe(true);
  });
});
