import { describe, it, expect, vi } from "vitest";
import { createActionKey } from "@poker-bot/shared";
import type { Action, ActionKey, GameState, GTOSolution } from "@poker-bot/shared";
import { FallbackHandler } from "../../src/strategy/fallbacks";
import { ActionSelector, SeededRNG } from "../../src/strategy/selection";
import { BetSizer } from "../../src/strategy/sizing";
import type { StrategyConfig } from "../../src/strategy/types";

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

function createState(legal: Action[]): GameState {
  return {
    handId: "fb-hand",
    street: "flop",
    pot: 100,
    positions: { hero: "BTN" } as any,
    players: new Map([[ "BTN", { stack: 1000 } as any ]]),
    board: [],
    actionHistory: [],
    legalActions: legal
  } as unknown as GameState;
}

const HERO_FOLD_KEY = createActionKey({ type: "fold", position: "BTN", street: "flop" } as Action);
const HERO_CALL_KEY = createActionKey({ type: "call", position: "BTN", street: "flop", amount: 10 } as Action);
const HERO_RAISE_KEY = createActionKey({ type: "raise", position: "BTN", street: "flop", amount: 50 } as Action);

function gtoFromDist(dist: Record<ActionKey, number>): GTOSolution {
  const actions = new Map<ActionKey, any>();
  for (const [key, freq] of Object.entries(dist) as [ActionKey, number][]) {
    actions.set(key, {
      solution: {
        frequency: freq
      }
    });
  }
  return { actions, meta: {} } as unknown as GTOSolution;
}

describe("FallbackHandler", () => {
  it("shouldUseGTOOnly returns true when no agent output or empty", () => {
    const handler = new FallbackHandler(createConfig());
    expect(handler.shouldUseGTOOnly(undefined as any)).toBe(true);
    expect(handler.shouldUseGTOOnly(null as any)).toBe(true);
    expect(handler.shouldUseGTOOnly({
      outputs: [],
      normalizedActions: new Map(),
      consensus: 0,
      winningAction: null,
      budgetUsedMs: 0,
      circuitBreakerTripped: false,
      startedAt: 0,
      completedAt: 0
    } as any)).toBe(true);
  });

  it("shouldUseGTOOnly returns true when circuit breaker tripped", () => {
    const handler = new FallbackHandler(createConfig());
    expect(handler.shouldUseGTOOnly({
      outputs: [],
      normalizedActions: new Map(),
      consensus: 0,
      winningAction: null,
      budgetUsedMs: 0,
      circuitBreakerTripped: true,
      startedAt: 0,
      completedAt: 0
    } as any)).toBe(true);
  });

  it("createGTOOnlyDecision selects from pure GTO and marks usedGtoOnlyFallback", () => {
    const config = createConfig();
    const handler = new FallbackHandler(config);
    const selector = new ActionSelector(123);
    const betSizer = new BetSizer(config);

    const gto = gtoFromDist({
      [HERO_FOLD_KEY]: 0.2,
      [HERO_CALL_KEY]: 0.8
    });

    const state = createState([
      { type: "fold", position: "BTN", street: "flop" } as any,
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any
    ]);

    const decision = handler.createGTOOnlyDecision({
      state,
      gto,
      selector,
      betSizer,
      rngSeed: 999,
      timing: { gtoTime: 10, synthesisTime: 1, totalTime: 11 },
      metadataBase: {}
    });

    expect(decision.metadata.usedGtoOnlyFallback).toBe(true);
    expect(decision.metadata.rngSeed).toBe(999);
    expect(["fold", "call"]).toContain(decision.action.type);
  });

  it("createGTOOnlyDecision falls back to SafeAction when GTO distribution is empty", () => {
    const config = createConfig();
    const handler = new FallbackHandler(config);
    const selector = new ActionSelector(1);
    const betSizer = new BetSizer(config);

    const gto = gtoFromDist({});
    const state = createState([
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any
    ]);

    const decision = handler.createGTOOnlyDecision({
      state,
      gto,
      selector,
      betSizer
    });

    expect(decision.action.type).toBeDefined();
    expect(decision.reasoning.fallbackReason).toContain("gto_empty");
  });

  it("createGTOOnlyDecision uses SafeAction when BetSizer fails", () => {
    const config = createConfig();
    const handler = new FallbackHandler(config);
    const selector = new ActionSelector(1);

    const failingSizer = {
      quantizeBetSize: vi.fn(() => ({ ok: false, reason: "test_failure" }))
    } as unknown as BetSizer;

    const gto = gtoFromDist({ [HERO_CALL_KEY]: 1.0 });
    const state = createState([
      { type: "call", position: "BTN", street: "flop", amount: 10 } as any
    ]);

    const decision = handler.createGTOOnlyDecision({
      state,
      gto,
      selector,
      betSizer: failingSizer
    });

    // Implementation emits explicit gto_only_sizing_failed:<reason> tag for this path
    expect(decision.reasoning.fallbackReason).toContain("gto_only_sizing_failed:");
    expect(decision.metadata.usedGtoOnlyFallback).toBe(true);
    expect(decision.action.type).toBeDefined();
  });

  it("createSafeActionDecision builds a safe fallback decision with reason", () => {
    const handler = new FallbackHandler(createConfig());
    const state = createState([
      { type: "fold", position: "BTN", street: "flop" } as any
    ]);

    const decision = handler.createSafeActionDecision({
      state,
      reason: "selection_failed:test"
    });

    expect(decision.action.type).toBe("fold");
    expect(decision.reasoning.fallbackReason).toBe("selection_failed:test");
    expect(decision.metadata.usedGtoOnlyFallback).toBe(false);
  });
});
