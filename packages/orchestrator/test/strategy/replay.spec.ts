import { describe, it, expect, vi } from "vitest";
import { createActionKey } from "@poker-bot/shared";
import type { Action, GameState, GTOSolution } from "@poker-bot/shared";
import type { AggregatedAgentOutput } from "../../../agents/src/types";
import { StrategyEngine } from "../../src/strategy/engine";
import type { StrategyConfig, StrategyDecision } from "../../src/strategy/types";
import type { RiskGuardAPI, RiskSnapshot } from "../../src/safety/types";

function strategyConfig(): StrategyConfig {
  return {
    alphaGTO: 0.7,
    betSizingSets: {
      preflop: [0.5, 1.0],
      flop: [0.33, 0.5, 1.0],
      turn: [0.5, 1.0],
      river: [0.5, 1.0]
    },
    divergenceThresholdPP: 30
  };
}

function stateWithHand(handId: string): GameState {
  return {
    handId,
    street: "flop",
    pot: 100,
    positions: { hero: "BTN" } as any,
    players: new Map([[ "BTN", { stack: 1000 } as any ]]),
    board: [],
    actionHistory: [],
    legalActions: [
      { type: "fold", position: "BTN", street: "flop" } as Action,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as Action,
      { type: "raise", position: "BTN", street: "flop", amount: 40 } as Action
    ]
  } as unknown as GameState;
}

function solverSolution(): GTOSolution {
  const fold = { type: "fold", position: "BTN", street: "flop" } as Action;
  const call = { type: "call", position: "BTN", street: "flop", amount: 10 } as Action;
  const raise = { type: "raise", position: "BTN", street: "flop", amount: 40 } as Action;
  const actions = new Map<string, any>();
  actions.set(createActionKey(fold), { action: fold, solution: { frequency: 0.2 } });
  actions.set(createActionKey(call), { action: call, solution: { frequency: 0.5 } });
  actions.set(createActionKey(raise), { action: raise, solution: { frequency: 0.3 } });
  return { actions, meta: {} } as unknown as GTOSolution;
}

function agentOutput(): AggregatedAgentOutput {
  return {
    outputs: [],
    normalizedActions: new Map([
      ["fold", 0.1],
      ["call", 0.3],
      ["raise", 0.6]
    ]),
    consensus: 0.7,
    winningAction: "raise" as any,
    budgetUsedMs: 50,
    circuitBreakerTripped: false,
    startedAt: Date.now(),
    completedAt: Date.now()
  } as AggregatedAgentOutput;
}

function riskController(): RiskGuardAPI {
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
  return {
    startHand: vi.fn(),
    incrementHandCount: vi.fn(() => 1),
    recordOutcome: vi.fn(() => snapshot),
    updateLimits: vi.fn(() => snapshot),
    checkLimits: vi.fn(() => ({ allowed: true, snapshot })),
    getSnapshot: vi.fn(() => snapshot),
    resetSession: vi.fn()
  } as unknown as RiskGuardAPI;
}

describe("StrategyEngine deterministic replay", () => {
  it("produces identical rng seeds and actions for same session + hand", async () => {
    const engine = new StrategyEngine(strategyConfig(), riskController());
    const state = stateWithHand("replay-hand");
    const gto = solverSolution();
    const agents = agentOutput();

    const decisionA: StrategyDecision = await engine.decide(state, gto, agents, "session-replay");
    const decisionB: StrategyDecision = await engine.decide(state, gto, agents, "session-replay");

    expect(decisionA.metadata.rngSeed).toBe(decisionB.metadata.rngSeed);
    expect(decisionA.action).toEqual(decisionB.action);
  });

  it("changes rng seed when session id differs", async () => {
    const engine = new StrategyEngine(strategyConfig(), riskController());
    const state = stateWithHand("replay-hand");
    const gto = solverSolution();
    const agents = agentOutput();

    const decisionA: StrategyDecision = await engine.decide(state, gto, agents, "session-one");
    const decisionB: StrategyDecision = await engine.decide(state, gto, agents, "session-two");

    expect(decisionA.metadata.rngSeed).not.toBe(decisionB.metadata.rngSeed);
  });
});
