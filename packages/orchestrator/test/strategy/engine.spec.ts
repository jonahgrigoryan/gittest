import { describe, it, expect, vi } from "vitest";
import { createActionKey } from "@poker-bot/shared";
import type { Action, GameState, GTOSolution, ActionKey } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "../../../agents/src/types";
import { StrategyEngine } from "../../src/strategy/engine";
import type { StrategyConfig, StrategyDecision } from "../../src/strategy/types";
import type { RiskGuardAPI as RiskController, RiskCheckResult, RiskSnapshot } from "../../src/safety/types";

function baseConfig(): StrategyConfig {
  return {
    alphaGTO: 0.6,
    betSizingSets: {
      preflop: [0.5, 1.0],
      flop: [0.33, 0.5, 0.75, 1.0],
      turn: [0.5, 1.0],
      river: [0.5, 1.0]
    },
    divergenceThresholdPP: 30
  };
}

function createState(): GameState {
  return {
    handId: "engine-hand",
    street: "flop",
    pot: 100,
    positions: { hero: "BTN" } as any,
    players: new Map([[ "BTN", { stack: 1000 } as any ]]),
    board: [],
    actionHistory: [],
    legalActions: [
      { type: "fold", position: "BTN", street: "flop" } as any,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any,
      { type: "raise", position: "BTN", street: "flop", amount: 50 } as any
    ]
  } as unknown as GameState;
}

function createGTOSolution(): GTOSolution {
  // Use simple, consistent test keys that match the StrategyEngine's parsing logic.
  const fold = { type: "fold", position: "BTN", street: "flop" } as Action;
  const call = { type: "call", position: "BTN", street: "flop", amount: 10 } as Action;
  const raise = { type: "raise", position: "BTN", street: "flop", amount: 50 } as Action;
  const actions = new Map<string, any>();
  actions.set(createActionKey(fold), {
    action: fold,
    solution: { frequency: 0.2 }
  });
  actions.set(createActionKey(call), {
    action: call,
    solution: { frequency: 0.5 }
  });
  actions.set(createActionKey(raise), {
    action: raise,
    solution: { frequency: 0.3 }
  });
  return { actions, meta: {} } as unknown as GTOSolution;
}

function createAgentsOk(): AggregatedAgentOutput {
  return {
    outputs: [],
    normalizedActions: new Map([
      ["fold", 0.1],
      ["call", 0.4],
      ["raise", 0.5]
    ]),
    consensus: 0.8,
    winningAction: "raise" as any,
    budgetUsedMs: 100,
    circuitBreakerTripped: false,
    startedAt: Date.now(),
    completedAt: Date.now()
  } as AggregatedAgentOutput;
}

function createAgentsEmpty(): AggregatedAgentOutput {
  return {
    outputs: [],
    normalizedActions: new Map(),
    consensus: 0,
    winningAction: null,
    budgetUsedMs: 0,
    circuitBreakerTripped: false,
    startedAt: Date.now(),
    completedAt: Date.now()
  } as AggregatedAgentOutput;
}

function createRiskController(allowed: boolean): RiskController {
  const snapshot: RiskSnapshot = {
    netProfit: 0,
    drawdown: 0,
    handsPlayed: 0,
    remainingHands: 100,
    remainingBankroll: 1000,
    liveExposure: 0,
    panicStop: !allowed,
    updatedAt: Date.now()
  };
  return {
    startHand: vi.fn(),
    incrementHandCount: vi.fn(() => 1),
    recordOutcome: vi.fn(() => snapshot),
    updateLimits: vi.fn(() => snapshot),
    checkLimits: vi.fn(() => ({
      allowed,
      snapshot
    })),
    getSnapshot: vi.fn(() => snapshot),
    resetSession: vi.fn()
  } as unknown as RiskController;
}

function createFullRiskController(): {
  api: RiskController;
  enforceImpl: (action: Action, state: GameState, fallback: () => Action) => { action: Action; result: RiskCheckResult };
} {
  const snapshot: RiskSnapshot = {
    netProfit: 0,
    drawdown: 0,
    handsPlayed: 0,
    remainingHands: 100,
    remainingBankroll: 1000,
    liveExposure: 0,
    panicStop: false,
    updatedAt: Date.now()
  };

  const enforceImpl = (
    action: Action,
    _state: GameState,
    _fallback: () => Action
  ): { action: Action; result: RiskCheckResult } => ({
    action,
    result: { allowed: true, snapshot }
  });

  const api: RiskController = {
    startHand: vi.fn(),
    incrementHandCount: vi.fn(() => 1),
    recordOutcome: vi.fn(() => snapshot),
    updateLimits: vi.fn(() => snapshot),
    checkLimits: vi.fn(() => ({
      allowed: true,
      snapshot
    })),
    getSnapshot: vi.fn(() => snapshot),
    resetSession: vi.fn()
  } as unknown as RiskController;

  return { api, enforceImpl };
}

describe("StrategyEngine", () => {
  it("produces a StrategyDecision with blended distribution when agents are available", async () => {
    const config = baseConfig();
    const { api } = createFullRiskController();

    // Stub TimeBudgetTracker with generous budget
    const tracker = {
      shouldPreempt: () => false,
      remaining: () => 2000,
      reserve: () => true,
      start: () => {},
      startComponent: () => {},
      endComponent: () => 10
    } as any;

    const engine = new StrategyEngine(config, api, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = createState();
    const gto = createGTOSolution();
    const agents = createAgentsOk();

    const decision = await engine.decide(state, gto, agents, "session-test");

    expect(decision).toBeDefined();
    expect(decision.action.type).toBeDefined();
    expect(decision.reasoning.blendedDistribution.size).toBeGreaterThan(0);
    expect(decision.metadata.configSnapshot.alphaGTO).toBe(config.alphaGTO);
  });

  it("falls back to GTO-only when agents are empty / trigger GTO-only path", async () => {
    const config = baseConfig();
    const { api } = createFullRiskController();

    const tracker = {
      shouldPreempt: () => false,
      remaining: () => 2000,
      reserve: () => true,
      start: () => {},
      startComponent: () => {},
      endComponent: () => 10
    } as any;

    const engine = new StrategyEngine(config, api, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = createState();
    const gto = createGTOSolution();
    const agents = createAgentsEmpty();

    const decision = await engine.decide(state, gto, agents, "session-test");

    expect(decision.metadata.usedGtoOnlyFallback).toBe(true);
    expect(decision.reasoning.fallbackReason === "gto_only" || decision.reasoning.fallbackReason?.includes("gto_only")).toBe(
      true
    );
  });

  it("uses SafeAction fallback when selection/sizing path fails", async () => {
    const config = baseConfig();
    const { api } = createFullRiskController();

    const tracker = {
      shouldPreempt: () => false,
      remaining: () => 2000,
      reserve: () => true,
      start: () => {},
      startComponent: () => {},
      endComponent: () => 10
    } as any;

    const engine = new StrategyEngine(config, api, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = {
      ...createState(),
      legalActions: [] // Force selection/sizing to fail / fallback
    } as GameState;

    const gto = createGTOSolution();
    const agents = createAgentsOk();

    const decision = await engine.decide(state, gto, agents, "session-test");

    expect(decision.action).toBeDefined();
    expect(decision.reasoning.fallbackReason).toBeDefined();
  });

  it("includes risk snapshot metadata when provided by controller", async () => {
    const config = baseConfig();
    const snapshot: RiskSnapshot = {
      netProfit: 10,
      drawdown: 0,
      handsPlayed: 5,
      remainingHands: 95,
      remainingBankroll: 990,
      liveExposure: 0,
      panicStop: false,
      updatedAt: Date.now()
    };

    const api: RiskController = {
      startHand: vi.fn(),
      incrementHandCount: vi.fn(() => 1),
      recordOutcome: vi.fn(() => snapshot),
      updateLimits: vi.fn(() => snapshot),
      checkLimits: vi.fn(() => ({
        allowed: true,
        snapshot
      })),
      getSnapshot: vi.fn(() => snapshot),
      resetSession: vi.fn()
    } as unknown as RiskController;

    const tracker = {
      shouldPreempt: () => false,
      remaining: () => 2000,
      reserve: () => true,
      start: () => {},
      startComponent: () => {},
      endComponent: () => 10
    } as any;

    const engine = new StrategyEngine(config, api, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = createState();
    const gto = createGTOSolution();
    const agents = createAgentsOk();

    const decision: StrategyDecision = await engine.decide(state, gto, agents, "session-test");

    expect(decision.metadata.riskSnapshot).toBeDefined();
    expect(decision.metadata.riskSnapshot!.remainingHands).toBe(95);
  });
});
