import { describe, it, expect } from "vitest";
import type { Action, GameState } from "@poker-bot/shared";
import { BetSizer } from "../../src/strategy/sizing";
import type { StrategyConfig } from "../../src/strategy/types";

function baseConfig(): StrategyConfig {
  return {
    alphaGTO: 0.6,
    betSizingSets: {
      preflop: [0.5, 1.0, 2.0],
      flop: [0.33, 0.5, 0.75, 1.0],
      turn: [0.5, 0.75, 1.0],
      river: [0.5, 1.0]
    },
    divergenceThresholdPP: 30
  };
}

function createState(pot: number, toCall: number, raises: number[], heroStack = 1000): GameState {
  const hero = "BTN";
  const legal: Action[] = [
    { type: "fold", position: hero, street: "flop" } as any,
    { type: "call", position: hero, street: "flop", amount: toCall } as any,
    ...raises.map(amount => ({ type: "raise", position: hero, street: "flop", amount } as any))
  ];
  return {
    handId: "sizing-hand",
    street: "flop",
    pot,
    positions: { hero } as any,
    players: new Map([[hero, { stack: heroStack } as any]]),
    board: [],
    actionHistory: [],
    legalActions: legal
  } as unknown as GameState;
}

describe("BetSizer.quantizeBetSize", () => {
  it("passes through non-raise actions unchanged", () => {
    const sizer = new BetSizer(baseConfig());
    const state = createState(100, 10, [30, 50]);
    const action: Action = { type: "call", position: "BTN", street: "flop", amount: 10 } as any;
    const result = sizer.quantizeBetSize(action, state);
    expect(result.ok).toBe(true);
    expect(result.ok && result.action).toEqual(action);
  });

  it("fails when no legal actions are available", () => {
    const sizer = new BetSizer(baseConfig());
    const state = {
      handId: "no-legal",
      street: "flop",
      pot: 100,
      positions: { hero: "BTN" } as any,
      players: new Map(),
      board: [],
      actionHistory: [],
      legalActions: []
    } as unknown as GameState;

    const action: Action = { type: "raise", position: "BTN", street: "flop", amount: 50 } as any;
    const result = sizer.quantizeBetSize(action, state);
    expect(result.ok).toBe(false);
  });

  it("fails when there are no legal raises", () => {
    const sizer = new BetSizer(baseConfig());
    const state = {
      handId: "no-raises",
      street: "flop",
      pot: 100,
      positions: { hero: "BTN" } as any,
      players: new Map(),
      board: [],
      actionHistory: [],
      legalActions: [{ type: "call", position: "BTN", street: "flop", amount: 10 } as any]
    } as unknown as GameState;

    const action: Action = { type: "raise", position: "BTN", street: "flop", amount: 50 } as any;
    const result = sizer.quantizeBetSize(action, state);
    expect(result.ok).toBe(false);
  });

  it("snaps to nearest legal raise when sizing set is present", () => {
    const sizer = new BetSizer(baseConfig());
    const state = createState(100, 0, [50, 75, 100]);
    const action: Action = { type: "raise", position: "BTN", street: "flop", amount: 80 } as any;

    const result = sizer.quantizeBetSize(action, state);
    expect(result.ok).toBe(true);
    const sized = result.ok && result.action;
    // Target is near 0.75*(pot+toCall)=75, should snap to 75
    expect(sized && sized.amount).toBe(75);
  });

  it("does not exceed hero stack or max legal", () => {
    const sizer = new BetSizer(baseConfig());
    const state = createState(500, 0, [200, 400, 800], 300); // hero stack 300
    const action: Action = { type: "raise", position: "BTN", street: "flop", amount: 800 } as any;

    const result = sizer.quantizeBetSize(action, state);
    expect(result.ok).toBe(true);
    const sized = result.ok && result.action;
    expect(sized && (sized.amount as number)).toBeLessThanOrEqual(300);
  });
});
