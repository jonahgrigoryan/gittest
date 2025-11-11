import { describe, it, expect, vi } from "vitest";
import type { Action, GameState } from "@poker-bot/shared";
import { StrategyRiskIntegration } from "../../src/strategy/risk";
import type { RiskCheckOptions, RiskCheckResult, RiskSnapshot } from "../../src/safety/types";

function createState(): GameState {
  return {
    handId: "risk-hand",
    street: "flop",
    pot: 100,
    positions: { hero: "BTN" } as any,
    players: new Map([[ "BTN", { stack: 1000 } as any ]]),
    board: [],
    actionHistory: [],
    legalActions: [
      { type: "fold", position: "BTN", street: "flop" } as any,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any
    ]
  } as unknown as GameState;
}

function createAction(type: Action["type"] = "call"): Action {
  if (type === "raise") {
    return { type: "raise", position: "BTN", street: "flop", amount: 50 } as any;
  }
  if (type === "fold") {
    return { type: "fold", position: "BTN", street: "flop" } as any;
  }
  return { type: "call", position: "BTN", street: "flop", amount: 10 } as any;
}

function createSnapshot(overrides: Partial<RiskSnapshot> = {}): RiskSnapshot {
  return {
    netProfit: 0,
    drawdown: 0,
    handsPlayed: 0,
    remainingHands: Number.POSITIVE_INFINITY,
    remainingBankroll: Number.POSITIVE_INFINITY,
    liveExposure: 0,
    panicStop: false,
    updatedAt: Date.now(),
    ...overrides
  };
}

describe("StrategyRiskIntegration", () => {
  it("allows action when risk controller reports allowed", () => {
    const snapshot = createSnapshot();
    const controller = {
      checkLimits: vi.fn((_action: Action, _state: GameState, _opts?: RiskCheckOptions): RiskCheckResult => ({
        allowed: true,
        snapshot
      })),
      getSnapshot: vi.fn(() => snapshot)
    };
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const integration = new StrategyRiskIntegration(controller as any, logger);

    const state = createState();
    const action = createAction("call");

    const { action: enforced, result } = integration.enforceWithFallback(
      action,
      state,
      () => ({ type: "fold", position: "BTN", street: "flop" } as any)
    );

    expect(controller.checkLimits).toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(enforced).toBe(action);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("uses fallback when risk controller blocks action", () => {
    const snapshot = createSnapshot({ panicStop: true });
    const controller = {
      checkLimits: vi.fn((_action: Action, _state: GameState, _opts?: RiskCheckOptions): RiskCheckResult => ({
        allowed: false,
        reason: { type: "bankroll", threshold: 1000, observed: 1500 },
        snapshot
      })),
      getSnapshot: vi.fn(() => snapshot)
    };
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const integration = new StrategyRiskIntegration(controller as any, logger);

    const state = createState();
    const unsafe = createAction("raise");
    const safe = { type: "fold", position: "BTN", street: "flop" } as any;

    const { action: enforced, result } = integration.enforceWithFallback(
      unsafe,
      state,
      () => safe
    );

    expect(controller.checkLimits).toHaveBeenCalled();
    expect(result.allowed).toBe(false);
    expect(enforced).toEqual(safe);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("exposes snapshot through getSnapshot", () => {
    const snapshot = createSnapshot({ remainingHands: 10 });
    const controller = {
      checkLimits: vi.fn((_action: Action, _state: GameState, _opts?: RiskCheckOptions): RiskCheckResult => ({
        allowed: true,
        snapshot
      })),
      getSnapshot: vi.fn(() => snapshot)
    };
    const integration = new StrategyRiskIntegration(controller as any);

    const out = integration.getSnapshot();
    expect(out.remainingHands).toBe(10);
  });
});
