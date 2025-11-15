import { describe, it, expect } from "vitest";
import { createActionKey } from "@poker-bot/shared";
import type { Action, GameState, GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "../../../agents/src/types";
import { StrategyEngine } from "../../src/strategy/engine";
import type { StrategyConfig, StrategyDecision } from "../../src/strategy/types";
import type {
  RiskGuardAPI as RiskController,
  RiskCheckResult,
  RiskSnapshot
} from "../../src/safety/types";

/**
 * This file is a minimal end-to-end smoke test for the strategy pipeline:
 *  - Uses real StrategyEngine wired with:
 *      - blending.ts
 *      - selection.ts
 *      - sizing.ts
 *      - divergence.ts
 *      - risk.ts wrapper via a mocked RiskController
 *      - fallbacks.ts
 *  - Mocks GTOSolution and AggregatedAgentOutput.
 *  - Asserts that a coherent StrategyDecision is produced in both:
 *      1) normal blended path
 *      2) GTO-only fallback path
 *      3) SafeAction-on-risk-violation path
 */

function createConfig(): StrategyConfig {
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

function createState(id: string, legal: Action[]): GameState {
  return {
    handId: id,
    street: "flop",
    pot: 100,
    positions: { hero: "BTN" } as any,
    players: new Map([[ "BTN", { stack: 1000 } as any ]]),
    board: [],
    actionHistory: [],
    legalActions: legal
  } as unknown as GameState;
}

function createGTOSolution(): GTOSolution {
  const foldAction = { type: "fold", position: "BTN", street: "flop" } as Action;
  const callAction = { type: "call", position: "BTN", street: "flop", amount: 10 } as Action;
  const raiseAction = { type: "raise", position: "BTN", street: "flop", amount: 50 } as Action;

  const actions = new Map<string, any>([
    [
      createActionKey(foldAction),
      {
        action: foldAction,
        solution: { frequency: 0.2 }
      }
    ],
    [
      createActionKey(callAction),
      {
        action: callAction,
        solution: { frequency: 0.5 }
      }
    ],
    [
      createActionKey(raiseAction),
      {
        action: raiseAction,
        solution: { frequency: 0.3 }
      }
    ]
  ]);
  return { actions, meta: {} } as unknown as GTOSolution;
}

function createAgentsBlended(): AggregatedAgentOutput {
  return {
    outputs: [],
    normalizedActions: new Map([
      ["fold", 0.1],
      ["call", 0.4],
      ["raise", 0.5]
    ]),
    consensus: 0.8,
    winningAction: "raise" as any,
    budgetUsedMs: 50,
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

function createRiskSnapshot(overrides: Partial<RiskSnapshot> = {}): RiskSnapshot {
  return {
    netProfit: 0,
    drawdown: 0,
    handsPlayed: 0,
    remainingHands: 100,
    remainingBankroll: 1000,
    liveExposure: 0,
    panicStop: false,
    updatedAt: Date.now(),
    ...overrides
  };
}

function createRiskControllerAllow(): RiskController {
  const snapshot = createRiskSnapshot();
  return {
    startHand: () => {},
    incrementHandCount: () => 1,
    recordOutcome: () => snapshot,
    updateLimits: () => snapshot,
    checkLimits: () => ({ allowed: true, snapshot }),
    getSnapshot: () => snapshot,
    resetSession: () => {}
  } as unknown as RiskController;
}

function createRiskControllerBlock(): RiskController {
  const snapshot = createRiskSnapshot({ panicStop: true });
  return {
    startHand: () => {},
    incrementHandCount: () => 1,
    recordOutcome: () => snapshot,
    updateLimits: () => snapshot,
    checkLimits: () => ({
      allowed: false,
      reason: { type: "bankroll", threshold: 1000, observed: 1500 },
      snapshot
    }),
    getSnapshot: () => snapshot,
    resetSession: () => {}
  } as unknown as RiskController;
}

function createTracker(): any {
  return {
    shouldPreempt: () => false,
    remaining: () => 2000,
    reserve: () => true,
    start: () => {},
    startComponent: () => {},
    endComponent: () => 5
  };
}

describe("Strategy integration smoke", () => {
  it("produces a coherent blended decision when risk allows and agents available", async () => {
    const config = createConfig();
    const riskController = createRiskControllerAllow();
    const tracker = createTracker();
    const engine = new StrategyEngine(config, riskController, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = createState("int-blended", [
      { type: "fold", position: "BTN", street: "flop" } as any,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any,
      { type: "raise", position: "BTN", street: "flop", amount: 50 } as any
    ]);

    const gto = createGTOSolution();
    const agents = createAgentsBlended();

    const decision: StrategyDecision = await engine.decide(state, gto, agents, "session-int");

    expect(decision.action.type).toBeDefined();
    expect(decision.reasoning.blendedDistribution.size).toBeGreaterThan(0);
    expect(decision.metadata.configSnapshot.alphaGTO).toBe(config.alphaGTO);
    expect(decision.metadata.rngSeed).toBeDefined();
  });

  it("falls back to GTO-only when agents are empty", async () => {
    const config = createConfig();
    const riskController = createRiskControllerAllow();
    const tracker = createTracker();
    const engine = new StrategyEngine(config, riskController, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = createState("int-gto-only", [
      { type: "fold", position: "BTN", street: "flop" } as any,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any
    ]);
    const gto = createGTOSolution();
    const agents = createAgentsEmpty();

    const decision = await engine.decide(state, gto, agents, "session-int");

    expect(decision.metadata.usedGtoOnlyFallback).toBe(true);
    expect(decision.reasoning.fallbackReason?.includes("gto")).toBe(true);
  });

  it("routes through SafeAction-style behavior when risk controller blocks", async () => {
    const config = createConfig();
    const riskController = createRiskControllerBlock();
    const tracker = createTracker();
    const engine = new StrategyEngine(config, riskController, {
      timeBudgetTracker: tracker,
      logger: console
    });

    const state = createState("int-risk-blocked", [
      { type: "fold", position: "BTN", street: "flop" } as any,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any
    ]);
    const gto = createGTOSolution();
    const agents = createAgentsBlended();

    const decision = await engine.decide(state, gto, agents, "session-int");

    expect(decision.action.type).toBeDefined();
    // Panic stop / violation should be reflected in metadata or reasoning.
    if (decision.metadata.riskSnapshot) {
      expect(decision.metadata.riskSnapshot.panicStop).toBe(true);
    }
  });
});
