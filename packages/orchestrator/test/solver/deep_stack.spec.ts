import { describe, it, expect } from "vitest";
import { calculateEffectiveStack, selectActionSet, STANDARD_ACTION_SET, DEEP_STACK_ACTION_SET } from "../../src/solver/deep_stack";
import type { GameState } from "@poker-bot/shared";

function createState(overrides: Partial<GameState> = {}): GameState {
  const players = new Map<GameState["players"] extends Map<infer P, infer S> ? [P, S][] : never>([
    ["BTN", { stack: 200, holeCards: [{ rank: "A", suit: "s" }, { rank: "K", suit: "s" }] }],
    ["SB", { stack: 120 }],
    ["BB", { stack: 150 }],
    ["UTG", { stack: 90 }],
    ["MP", { stack: 60 }],
    ["CO", { stack: 140 }],
  ]);

  const base: GameState = {
    handId: "hand-002",
    gameType: "NLHE_6max",
    blinds: { small: 1, big: 2 },
    positions: {
      hero: "BTN",
      button: "BTN",
      smallBlind: "SB",
      bigBlind: "BB",
    },
    players,
    communityCards: [],
    pot: 0,
    street: "preflop",
    actionHistory: [],
    legalActions: [],
    confidence: { overall: 1, perElement: new Map() },
    latency: 0,
  };

  return {
    ...base,
    ...overrides,
    players: overrides.players ?? players,
    actionHistory: overrides.actionHistory ?? base.actionHistory,
    legalActions: overrides.legalActions ?? base.legalActions,
  };
}

describe("deep stack utilities", () => {
  it("computes effective stack for heads-up play", () => {
    const state = createState({
      gameType: "HU_NLHE",
      players: new Map([
        ["BTN", { stack: 160, holeCards: [{ rank: "A", suit: "s" }, { rank: "Q", suit: "s" }] }],
        ["BB", { stack: 120 }],
      ]),
      positions: { hero: "BTN", button: "BTN", smallBlind: "BTN", bigBlind: "BB" },
    });

    const effective = calculateEffectiveStack(state);
    expect(effective).toBeCloseTo(60); // min(160,120)/bigBlind(2) = 60bb
  });

  it("computes effective stack as minimum active stack", () => {
    const state = createState();
    const effective = calculateEffectiveStack(state);
    expect(effective).toBeCloseTo(30); // min stack 60 -> 60/2 = 30bb
  });

  it("selects deep-stack action set when threshold exceeded", () => {
    const actionSet = selectActionSet(150, 100);
    expect(actionSet).toEqual(DEEP_STACK_ACTION_SET);
  });

  it("selects standard action set when below threshold", () => {
    const actionSet = selectActionSet(80, 100);
    expect(actionSet).toEqual(STANDARD_ACTION_SET);
  });
});
