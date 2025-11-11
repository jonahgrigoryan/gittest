import { describe, it, expect } from "vitest";
import type { Action, ActionKey, GameState } from "@poker-bot/shared";
import { ActionSelector, SeededRNG, deriveRngForDecision } from "../../src/strategy/selection";

function createState(legal: Action[]): GameState {
  return {
    handId: "hand_sel_1",
    street: "flop",
    pot: 100,
    positions: { hero: "BTN" } as any,
    players: new Map(),
    board: [],
    actionHistory: [],
    legalActions: legal
  } as unknown as GameState;
}

describe("ActionSelector", () => {
  it("SeededRNG produces deterministic sequence", () => {
    const rng1 = new SeededRNG(123);
    const rng2 = new SeededRNG(123);
    const seq1 = [rng1.next(), rng1.next(), rng1.next()];
    const seq2 = [rng2.next(), rng2.next(), rng2.next()];
    expect(seq1).toEqual(seq2);
  });

  it("selectAction falls back to last key when cumulative sampling misses", () => {
    const selector = new ActionSelector(1);
    const dist = new Map<ActionKey, number>();
    dist.set("flop:BTN:fold:-", 0.0);
    dist.set("flop:BTN:call:10.00", 0.0);
    dist.set("flop:BTN:raise:50.00", 1.0);
    const rng = selector.createRNG("hand_nonempty");
    const result = selector.selectAction(dist, rng);
    expect(result.ok).toBe(true);
    expect(result.key).toBe("flop:BTN:raise:50.00");
  });
});
